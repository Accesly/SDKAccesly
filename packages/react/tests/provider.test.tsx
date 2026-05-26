import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import {
  InMemoryDeviceStore,
  InMemorySessionStorage,
  type AuthClient,
  type AuthTokens,
} from '@accesly/core';
import { AcceslyProvider } from '../src/provider.js';
import { useAccesly } from '../src/hooks/useAccesly.js';

function makeMockAuthClient(over: Partial<AuthClient> = {}): AuthClient {
  return {
    signUp: vi.fn().mockResolvedValue({ userSub: 'sub', userConfirmed: true }),
    confirmSignUp: vi.fn().mockResolvedValue(undefined),
    resendConfirmationCode: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function StatusReporter() {
  const { auth } = useAccesly();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="username">{auth.username ?? 'none'}</span>
    </div>
  );
}

describe('@accesly/react AcceslyProvider', () => {
  it('renders children with anonymous status by default', async () => {
    const authClient = makeMockAuthClient();
    render(
      <AcceslyProvider
        appId="test"
        env="dev"
        overrides={{
          authClient,
          sessionStorage: new InMemorySessionStorage(),
          deviceStore: new InMemoryDeviceStore(),
        }}
      >
        <StatusReporter />
      </AcceslyProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('username').textContent).toBe('none');
  });

  it('useAccesly throws when used outside the Provider', () => {
    function Bad() {
      useAccesly();
      return null;
    }
    // React 18 logs a console.error for thrown render errors; silence it.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Bad />)).toThrow(/AcceslyProvider/);
    spy.mockRestore();
  });
});

function SignInButton({ email, password }: { email: string; password: string }) {
  const { auth } = useAccesly();
  return (
    <>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="username">{auth.username ?? 'none'}</span>
      <button onClick={() => void auth.signIn(email, password)}>Sign in</button>
    </>
  );
}

describe('@accesly/react useAccesly.auth', () => {
  it('signIn promotes status to authenticated and surfaces username', async () => {
    const tokens: AuthTokens = {
      idToken: 'id',
      accessToken: 'ac',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3_600_000,
      username: 'alice@accesly.xyz',
    };
    const authClient = makeMockAuthClient({
      signIn: vi.fn().mockResolvedValue(tokens),
    });
    const storage = new InMemorySessionStorage();
    render(
      <AcceslyProvider
        appId="t"
        env="dev"
        overrides={{ authClient, sessionStorage: storage, deviceStore: new InMemoryDeviceStore() }}
      >
        <SignInButton email="alice@accesly.xyz" password="pwd" />
      </AcceslyProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));

    await act(async () => {
      screen.getByText('Sign in').click();
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('username').textContent).toBe('alice@accesly.xyz');
    expect(storage.load()?.idToken).toBe('id');
  });

  it('signOut clears username and reverts to anonymous', async () => {
    const tokens: AuthTokens = {
      idToken: 'id',
      accessToken: 'ac',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3_600_000,
      username: 'bob@accesly.xyz',
    };
    const storage = new InMemorySessionStorage();
    storage.save(tokens);
    const authClient = makeMockAuthClient();

    function SignOutPanel() {
      const { auth } = useAccesly();
      return (
        <>
          <span data-testid="status">{auth.status}</span>
          <button onClick={() => void auth.signOut()}>Sign out</button>
        </>
      );
    }

    render(
      <AcceslyProvider
        appId="t"
        env="dev"
        overrides={{ authClient, sessionStorage: storage, deviceStore: new InMemoryDeviceStore() }}
      >
        <SignOutPanel />
      </AcceslyProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    await act(async () => {
      screen.getByText('Sign out').click();
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(storage.load()).toBeNull();
  });
});

import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import {
  InMemoryDeviceStore,
  InMemorySessionStorage,
  type AuthClient,
  type AuthTokens,
} from '@accesly/core';
import { AcceslyProvider } from '../src/provider.js';
import { AuthForm, BalanceCard, MovementsList, ReceiveFlow } from '../src/kit/index.js';

afterEach(cleanup);

function makeAuthClient(over: Partial<AuthClient> = {}): AuthClient {
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

function withProvider(node: React.ReactNode, opts: { authClient?: AuthClient; tokens?: AuthTokens } = {}) {
  const storage = new InMemorySessionStorage();
  if (opts.tokens) storage.save(opts.tokens);
  return render(
    <AcceslyProvider
      appId="test-app"
      env="dev"
      cognitoConfig={{
        region: 'us-east-1',
        userPoolId: 'us-east-1_TEST',
        userPoolClientId: 'test-client',
      }}
      overrides={{
        authClient: opts.authClient ?? makeAuthClient(),
        sessionStorage: storage,
        deviceStore: new InMemoryDeviceStore(),
      }}
    >
      {node}
    </AcceslyProvider>,
  );
}

beforeEach(() => {
  // Block /app-config fetches so useAppConfig + useBranding don't pollute test logs.
  // Hooks fall back to safe defaults when the request rejects.
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
});

describe('@accesly/react/kit AuthForm', () => {
  it('renders email + google buttons when both providers are enabled', async () => {
    // Default `useAuthProviders` returns ['email', 'google'] when config is missing.
    withProvider(<AuthForm />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/tucorreo/)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Iniciar sesión/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Continuar con Google/i })).toBeTruthy();
    });
  });

  it('calls authClient.signIn with the form values', async () => {
    const tokens: AuthTokens = {
      idToken: 'id',
      accessToken: 'ac',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3_600_000,
      username: 'ana@x.io',
    };
    const signIn = vi.fn().mockResolvedValue(tokens);
    const authClient = makeAuthClient({ signIn });
    withProvider(<AuthForm />, { authClient });

    const emailInput = await screen.findByPlaceholderText(/tucorreo/);
    const passwordInput = screen.getByPlaceholderText(/Contraseña/);
    fireEvent.change(emailInput, { target: { value: 'ana@x.io' } });
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });

    await act(async () => {
      screen.getByRole('button', { name: /Iniciar sesión/i }).click();
    });

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith('ana@x.io', 'secret123');
  });

  it('renders sign-up button when mode=sign-up', async () => {
    withProvider(<AuthForm mode="sign-up" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Crear cuenta/i })).toBeTruthy();
    });
  });
});

describe('@accesly/react/kit BalanceCard', () => {
  it('renders the wallet header even before balance loads', async () => {
    withProvider(<BalanceCard primaryAsset="USDC" />);
    await waitFor(() => {
      // The "Saldo USDC" label is always present.
      expect(screen.getByText(/Saldo USDC/i)).toBeTruthy();
    });
  });

  it('shows XLM as primary when configured', async () => {
    withProvider(<BalanceCard primaryAsset="XLM" />);
    await waitFor(() => {
      expect(screen.getByText(/Saldo XLM/i)).toBeTruthy();
    });
  });
});

describe('@accesly/react/kit MovementsList', () => {
  it('shows the empty state when there are no events', async () => {
    withProvider(<MovementsList />);
    await waitFor(() => {
      expect(screen.getByText(/Aún no hay movimientos/i)).toBeTruthy();
    });
  });

  it('renders custom emptyState when provided', async () => {
    withProvider(<MovementsList emptyState={<span>Sin actividad</span>} />);
    await waitFor(() => {
      expect(screen.getByText(/Sin actividad/i)).toBeTruthy();
    });
  });
});

describe('@accesly/react/kit ReceiveFlow', () => {
  it('shows the QR placeholder when no walletAddress is resolved', async () => {
    withProvider(<ReceiveFlow walletAddress="GBV2EXAMPLEXBQU34567890ABCDEFGHIJKL" />);
    await waitFor(() => {
      const heading = screen.getByText(/Recibir/i);
      expect(heading).toBeTruthy();
    });
  });

  it('renders a custom renderQr when passed', async () => {
    const renderQr = vi.fn((text: string) => <div data-testid="qr">qr-for-{text}</div>);
    withProvider(
      <ReceiveFlow
        walletAddress="GBV2EXAMPLEXBQU34567890ABCDEFGHIJKL"
        renderQr={renderQr}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('qr').textContent).toContain('GBV2EXAMPLE');
    });
    expect(renderQr).toHaveBeenCalled();
  });
});

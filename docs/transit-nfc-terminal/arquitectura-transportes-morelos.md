> **Nota (noviembre 2026).** Este documento es la investigación y el diseño de agosto de 2026 que dio origen al piloto de la Ruta 9 (Temixco, Morelos), donde se liquidaron los primeros pasajes en Stellar mainnet con un token cerrado (MXNT). El sprint del tercer Instaward (ver [`SOW`](./Accesly-Instawards-SOW-NFC-fare-terminal-Nov-2026.pdf)) toma esta arquitectura y cambia dos cosas: la terminal pasa a ser una PWA en el celular del chofer (Web NFC y QR) y la liquidación se hace en USDC en lugar del token cerrado. El resto (cuentas por unidad, facilitador, trazabilidad por pasaje) se conserva.

# Del gateway bancario al monedero cerrado

**Investigación, diagnóstico y plan de implementación de un sistema de cobro digital para el transporte público de Morelos**

Versión: agosto 2026 · Autor: dirección del proyecto · Estado: documento de trabajo

---

## Resumen ejecutivo

Este documento reconstruye el proceso de investigación que llevó al diseño final del sistema de cobro para el transporte público de Morelos. La secuencia fue la siguiente:

1. Se intentó construir una terminal de pago propia para cobrar el pasaje. Se descubrió que los rieles bancarios mexicanos están cerrados por diseño: quien no es adquirente o agregador autorizado depende de SDK propietarios, comisiones que no negocia y restricciones de personalización.
2. Se evaluó blockchain como vía de escape. Se descubrió que blockchain resuelve el costo de *liquidación*, pero no el de *entrada y salida de dinero fiat* (onramp/offramp), que es donde vive la comisión y la fricción regulatoria.
3. Se investigó si el KYC podía eliminarse o hacerse invisible (datos de tarjeta, ZK). Se concluyó que no: en México, la operación con activos virtuales exige identificación desde el primer peso.
4. Se reformuló la pregunta: en lugar de preguntar cómo abaratar la conversión fiat↔cripto, se preguntó **cómo evitar tener que hacerla**.
5. La respuesta fue un **monedero cerrado (*****closed loop*****)**: un token de transporte no convertible en manos del usuario, recargado con efectivo en tiendas, liquidado a los concesionarios por SPEI, y registrado en Stellar por trazabilidad y auditoría multiparte.

La conclusión central: **el ahorro no viene de la tecnología, viene del perímetro regulatorio**. Al mantener el saldo dentro de un circuito cerrado de un solo servicio, el sistema queda fuera del riel de tarjetas, fuera de la definición de fondos de pago electrónico y por debajo de todos los umbrales de identificación de la ley antilavado.

---

## 1. Punto de partida: por qué no se puede cobrar barato

### 1.1 El muro de los agregadores

El primer intento fue construir una aplicación de cobro de pasaje. Los hallazgos operativos fueron consistentes:

- **Solo hay una puerta de entrada.** Cobrar con tarjeta obliga a pasar por un gateway o agregador bancario, y las comisiones que ofrecen a un comercio pequeño son altas para el ticket promedio del transporte.
- **El SDK es la jaula.** Para operar una terminal y personalizarla hay que usar el SDK del proveedor. Eso significa que el proveedor define la experiencia de cobro, el flujo de conciliación y, sobre todo, la comisión. No hay margen de negociación técnica.
- **La personalización está limitada por contrato, no por tecnología.** En varios casos, configurar comportamientos adicionales en la terminal (flujos propios, lógica de tarifa, integración con el despacho) simplemente no está permitido, aunque el hardware lo soporte.

### 1.2 Ser tu propio adquirente

La salida obvia sería convertirse en gateway y quedarse con el margen. Esa ruta existe, pero es una ruta institucional, no técnica: implica ser partner o cliente de un procesador como Prosa, negociar directamente con los proveedores de red, y satisfacer una lista de requerimientos de certificación, capital, seguridad y cumplimiento. No es un problema que se resuelva escribiendo código; es un problema que se resuelve con años y con balance.

### 1.3 El hallazgo importante: el problema es el micropago, no el porcentaje

Este es el punto que reordenó todo el análisis. La discusión pública sobre comisiones se centra en el porcentaje, pero en el transporte el porcentaje no es lo que quiebra el modelo: **es el componente fijo**.

En México, la cuota de intercambio —lo que el banco emisor le cobra al adquirente— puede llegar hasta 1.15% del monto en tarjetas de débito, con un tope de $13.50 pesos por operación, y hasta 1.91% en tarjetas de crédito. Sobre esa cuota, el adquirente monta su tasa de descuento y su margen.

Sobre un pasaje de $10 pesos, incluso una tasa de descuento agresiva del 2% deja $0.20 de comisión ad valorem. El problema es que ninguna transacción de tarjeta cuesta $0.20 de operar: hay autorización en línea, ruteo, compensación, liquidación, prevención de fraude, atención de contracargos y conciliación. El costo real por transacción del riel de tarjetas tiene un piso fijo que, sobre un ticket de $10, representa una fracción inaceptable del ingreso.

**Corolario:** cualquier arquitectura que cobre pasaje transacción por transacción sobre el riel de tarjetas está condenada por aritmética, no por avaricia de los bancos. La solución no es negociar mejor la comisión. Es **sacar el micropago del riel** y agregarlo: que la operación cara (la entrada de dinero) ocurra una vez por cada muchos viajes, no una vez por viaje.

Esta idea —agregar micropagos fuera del riel caro— es exactamente lo que hacen los sistemas de transporte del mundo con las tarjetas de prepago, y es la que terminaría orientando el diseño final.

---

## 2. La hipótesis blockchain y dónde se rompe

### 2.1 El costo se mudó, no desapareció

La segunda hipótesis fue usar blockchain: si la liquidación cuesta fracciones de centavo, el pasaje puede cobrarse sin comisión significativa. Es cierto —y es la razón por la que Stellar sigue en el diseño final— pero incompleta.

El dinero de la gente nace en fiat. Para que exista saldo on-chain alguien tuvo que convertir pesos en tokens (*onramp*) y, al final de la cadena, convertir tokens en pesos (*offramp*). Ahí es donde reaparece todo lo que se quería evitar:

- El onramp y el offramp cobran comisión, y en varios proveedores esa comisión es **mayor** que la de los rieles convencionales.
- Ambos exigen KYC, y en algunos casos KYB, lo que hace inviable un flujo de alta masiva de pasajeros.
- La mayoría de los proveedores no está construida para stablecoins locales de países específicos, sino para dólar. Convertir MXN → USDC → MXN agrega un salto cambiario y un margen.
- En el ecosistema Stellar en particular, la oferta de rampas para peso mexicano es delgada, lo que impide una adopción real.

**Conclusión intermedia:** la fricción no está en la cadena. Está en las puertas.

### 2.2 Las "tarjetas cripto" no evaden el riel: lo usan

Un supuesto que valía la pena romper: las tarjetas de débito cripto que existen hoy (las de exchanges y las emitidas por proveedores de tarjeta como servicio) **no son un riel alternativo**. Son tarjetas Visa o Mastercard normales, con un offramp automático detrás. El comercio paga exactamente la misma tasa de descuento y la misma cuota de intercambio que con cualquier otra tarjeta.

Es decir: no existe hoy un "tap to pay de fiat a cripto" que abarate el cobro. Lo que existe es un tap to pay convencional con una liquidación cripto detrás. El ahorro percibido en esos productos suele venir de subsidio o de rendimiento sobre reservas, no de una eficiencia del riel.

### 2.3 Stablecoins de peso: existen, pero resuelven otro problema

El mercado de stablecoins de peso mexicano ya no es teórico. MXNB es una stablecoin respaldada 1:1 con el peso, emitida por Juno —empresa de Bitso—, que se acuña depositando MXN por SPEI y se redime de vuelta a pesos hacia cuentas bancarias mexicanas. También existen MMXN, respaldada por Monetary Digital, y MXNe, lanzada por el emisor estadounidense Brale en las redes Solana y Stellar, esta última especialmente relevante por la elección de red del proyecto.

Pero conviene leer con precisión para qué sirven. MXNB está pensada como una primitiva de liquidación: se sostiene minutos u horas entre recibir dólares y empujar pesos por SPEI, no como saldo de balance. Es infraestructura de **tesorería transfronteriza B2B**, no de **cobro minorista de $10 pesos**. Adoptarla para el pasaje habría significado heredar todo el problema de onramp/offramp por usuario final.

---

## 3. Investigación regulatoria: qué dice realmente la ley mexicana

Esta fue la sección que definió el diseño. Las preguntas de investigación planteadas al inicio fueron tres, y las tres tienen respuesta.

### 3.1 ¿Cuándo aplica KYC en el proceso fiat ↔ cripto?

**Respuesta: siempre, y el marco se endureció recientemente.**

El intercambio de activos virtuales es una actividad vulnerable bajo el artículo 17 de la Ley Federal para la Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita (LFPIORPI). A diferencia de otras fracciones, aquí la identificación se exige desde el primer peso, sin umbral mínimo.

Además, la reforma a la LFPIORPI publicada el 16 de julio de 2025 redujo el umbral de aviso al SAT para activos virtuales de 645 UMA a 210 UMA —una caída del 67%—, equivalente a $24,635.10 pesos. La misma reforma amplió la conservación de documentos de 5 a 10 años, redujo a 24 horas el plazo de aviso por operación inusual e introdujo la obligación de implementar mecanismos automatizados de detección.

Esto cierra la puerta a la idea original de "hacer KYC con los datos de la tarjeta del usuario". Los datos de una tarjeta no constituyen identificación en términos de la LFPIORPI: la ley exige verificar identidad contra documentos de identificación con reconocimiento oficial y conservar copia. No hay una vía en la que el usuario no se dé de alta.

### 3.2 ZK-KYC: por qué no resuelve el problema planteado

La intuición sobre zero-knowledge era correcta en su lectura del problema, pero apunta a la variable equivocada.

Las pruebas de conocimiento cero permiten **minimizar la divulgación** —probar "este usuario fue verificado y no está en listas" sin revelar quién es— y son excelentes para privacidad y para portabilidad de la credencial. Lo que no hacen es **eliminar la emisión de la credencial**: alguien, en algún momento, tuvo que verificar documentos oficiales contra una persona real. El alta sigue existiendo; solo cambia quién la ve después.

Y para el caso de uso del transporte, el alta *es* el problema. Un pasajero que sube a un camión en Temixco no va a completar un onboarding de identidad para pagar $10 pesos, con o sin criptografía elegante detrás. La fricción que mata la adopción es la del primer minuto, no la del expediente.

### 3.3 Ley Fintech: por qué no se puede ser "un wallet" sin serlo

El marco relevante es la Ley para Regular las Instituciones de Tecnología Financiera (Ley Fintech, 2018). Tres piezas importan:

**a) La actividad está reservada.** El artículo 22 establece que los servicios prestados al público de manera habitual y profesional consistentes en la emisión, administración, redención y transmisión de fondos de pago electrónico, a través de aplicaciones, interfaces o páginas de internet, solo pueden ser prestados por Instituciones de Fondos de Pago Electrónico. Operar sin autorización no es una zona gris: es actividad reservada.

**b) La autorización es lenta y cara.** Los tiempos de autorización IFPE que reporta el mercado se miden en años, no en meses. Para un piloto de transporte estatal, esa ruta es incompatible con cualquier calendario razonable.

**c) Banxico cerró la puerta cripto al cliente final.** La Circular 4/2019 es explícita: las instituciones solo pueden celebrar operaciones con activos virtuales que correspondan a operaciones internas, con autorización previa de Banxico, y no son elegibles para autorización aquellas operaciones mediante las cuales pretendan prestar de manera directa a sus clientes servicios de intercambio, transmisión o custodia de activos virtuales.

Traducido: en México, ni siquiera una IFPE autorizada puede ofrecerle cripto a su usuario. La cripto puede vivir **detrás** de la operación, no **frente** al cliente. Este hallazgo es determinante para el diseño: obliga a que el usuario nunca vea, ni tenga, ni gestione un activo virtual.

### 3.4 El hueco que sí existe: el artículo 24 y los umbrales de prepago

Aquí está la salida legal del problema, y no está en la cripto: está en la naturaleza del instrumento.

**Exclusión de la Ley Fintech.** El artículo 24 establece que no se considerarán fondos de pago electrónico los derechos derivados de programas de lealtad o recompensa ofrecidos por personas morales a sus clientes que solo puedan ser aceptados por dichas personas morales o por sociedades afiliadas a tales programas a cambio de bienes, servicios o beneficios, siempre y cuando no puedan ser convertidos a moneda. Por eso los vales de despensa y los programas de lealtad quedan fuera del régimen de la Ley Fintech.

**Umbrales de la ley antilavado.** El instrumento sí cae en la fracción II del artículo 17 de la LFPIORPI, que cubre la emisión o comercialización habitual o profesional de tarjetas que no provengan de entidades financieras, incluyendo tarjetas prepagadas y todas aquellas que constituyan instrumentos de almacenamiento de valor monetario. Pero los umbrales son generosos para este caso de uso: para tarjetas prepagadas y para monederos, vales o certificados, tanto el umbral de identificación como el de aviso son de 645 UMA, equivalentes a $75,664.95 pesos en 2026.

**Por qué esto lo cambia todo:**

| Vía | Identificación del usuario | Aviso al SAT |
| --- | --- | --- |
| Intercambio de activos virtuales | Desde el primer peso | Desde 210 UMA (\~$24,635) |
| Tarjeta prepagada / monedero cerrado | Desde 645 UMA (\~$75,665) | Desde 645 UMA (\~$75,665) |

Una tarjeta de transporte con saldos de $20 a $150 pesos y recargas de $50 nunca se acerca a $75,665 pesos en una operación. **El pasajero no requiere KYC.** No porque se evada la regulación, sino porque el legislador ya decidió que un instrumento de valor bajo, de circuito cerrado y no convertible, no representa riesgo de lavado.

La obligación de registro como actividad vulnerable, expediente de lineamientos, conservación por diez años y capacitación **sí aplica al emisor**. Eso es carga administrativa manejable, no una barrera de entrada.

---

## 4. La pregunta de fondo: ¿el dinero es un circuito cerrado?

Después de agotar las vías técnicas apareció una pregunta más incómoda: si no hay forma de cobrar sin comisión, ni siquiera en circuito cerrado, ¿es el dinero un sistema deliberadamente cerrado, donde la regulación y la concentración bancaria impiden que surjan modelos económicos nuevos?

La respuesta honesta es matizada, y vale la pena escribirla con precisión porque de ella depende cómo se presenta el proyecto ante gobierno e inversionistas.

**Lo que sí es cierto:** el acceso al riel de pagos está reservado, la reserva es costosa, y el costo de entrada favorece estructuralmente a los incumbentes. Un desarrollador con una buena idea no puede simplemente "conectarse a los pagos" como se conecta a una API. Eso es una barrera real y tiene efectos reales sobre la innovación.

**Lo que no es cierto:** que la barrera exista *solo* para proteger rentas. Buena parte del costo del riel es el costo de garantizar liquidación, absorber fraude, resolver contracargos y sostener trazabilidad antilavado. Un sistema de pagos sin esas garantías no es un sistema más barato; es un sistema que traslada el riesgo al usuario. La comisión paga algo.

**Lo que se deriva para el proyecto:** la estrategia ganadora no es pelear con el riel ni intentar replicarlo. Es **no necesitarlo**. Un circuito cerrado de valor bajo, con una sola categoría de bien consumible (el pasaje), no requiere garantía de liquidación interbancaria, no genera contracargos y no mueve montos de riesgo. Por eso puede ser barato: porque hace menos, no porque sea más listo.

---

## 5. El giro: efectivo → valor digital, sin pasar por el banco del usuario

La pregunta que desbloqueó el diseño fue: **¿cómo obtiene alguien valor digital sin pasar por el sistema bancario, si nació dentro de un sistema fiat?**

La respuesta es el efectivo. En Morelos, el pasaje se paga en efectivo, los pasajeros mayoritariamente no tienen ni quieren una app bancaria, y las tienditas ya son el punto de contacto financiero de facto del barrio.

La versión original de esta idea era una empresa de efectivo a cripto cobrando 1% al recibir el efectivo. Esa versión no sobrevive al análisis regulatorio de la sección 3: recibir efectivo y entregar activo virtual es intercambio de activos virtuales, con identificación desde el primer peso, aviso desde 210 UMA y todo el aparato de la reforma de 2025. Además, el beneficio para el usuario sería difuso: la mayoría de la gente no quiere cripto, quiere que le funcione el camión.

Pero la **estructura** de la idea sí sobrevive, con un cambio de una sola palabra: en lugar de convertir efectivo en **activo virtual**, se convierte efectivo en **derecho de transporte**.

- El efectivo entra por la tiendita, que es el punto de contacto natural.
- Lo que el pasajero recibe no es dinero ni un activo virtual: es saldo consumible en un solo servicio.
- El dinero real nunca sale del sistema bancario formal: la tiendita paga por SPEI, el concesionario cobra por SPEI. Solo el *derecho de uso* circula digitalmente.
- El beneficio para el usuario no es ideológico, es concreto: no hacer fila, no dar cambio, saldo recargable en la esquina, y viajes de bonificación.

Este es el momento en que el proyecto deja de ser "un producto cripto para transporte" y pasa a ser "un sistema de transporte que usa una cadena para auditarse".

---

## 6. Por qué el monedero cerrado es la respuesta correcta

Recapitulando el árbol de decisiones completo:

| Alternativa | Por qué se descartó |
| --- | --- |
| Terminal con agregador (Clip, Mercado Pago, etc.) | Comisión incompatible con ticket de $10; SDK cerrado; sin control del producto |
| Ser adquirente / gateway propio | Barrera institucional (Prosa, certificaciones, capital), no técnica |
| Wallet cripto por pasajero con onramp/offramp | KYC obligatorio desde el primer peso; comisión de rampa mayor al riel convencional; Circular 4/2019 impide ofrecer cripto al cliente |
| Tarjeta de débito cripto | Corre sobre el mismo riel Visa/Mastercard; mismo costo |
| Stablecoin de peso como saldo del usuario | Buena para tesorería B2B, no para cobro minorista; hereda el problema de rampas |
| **Monedero cerrado con registro en Stellar** | **Adoptado** |

### Qué aporta Stellar si el sistema es cerrado

Esta pregunta la va a hacer el primer evaluador serio, así que conviene tener la respuesta escrita: si el circuito es cerrado, ¿por qué no una base de datos?

Stellar aporta tres cosas que una base de datos no da gratis:

1. **Auditoría multiparte.** Los concesionarios de la Ruta 9 no necesitan confiar en el operador del sistema ni entre ellos: cada cobro es verificable de forma independiente contra el ledger. En una asociación donde el conflicto histórico es sobre quién cobró qué, esto no es un detalle técnico, es la condición política de adopción.
2. **Liquidación instantánea entre cuentas** con costos despreciables por operación, que es exactamente el requisito del micropago identificado en la sección 1.3.
3. **Trazabilidad del subsidio.** El campo `Memo` permite seguir un lote de tokens de bonificación desde la tiendita que lo vendió hasta la unidad donde se redimió. Ese dato es el argumento ante la Secretaría de Movilidad y ante cualquier fuente de financiamiento: subsidio con comprobación de destino.

Lo que Stellar **no** aporta aquí es evasión de costos regulatorios. El ahorro viene del perímetro legal, no de la cadena. Conviene decirlo así en las presentaciones, porque un evaluador financiero lo va a detectar de inmediato si se presenta al revés.

---

## 7. Riesgos abiertos del diseño final

Estos puntos no invalidan el plan, pero deben resolverse antes de escalar más allá del piloto. Se listan en orden de gravedad.

**7.1 La exclusión del artículo 24 exige no convertibilidad.** La exclusión aplica a instrumentos que **no puedan convertirse a moneda**. En el diseño, el concesionario devuelve tokens a tesorería y recibe SPEI. Eso es una redención en dinero. El argumento defendible es que la no convertibilidad aplica al **tenedor consumidor** (el pasajero, que solo puede gastar en pasaje) y que la liquidación al concesionario es el pago del servicio prestado, no un rescate de saldo. Ese argumento debe estar sostenido por una opinión legal escrita antes de operar fuera del piloto. **Acción: opinión legal formal sobre encuadre del instrumento.**

**7.2 El token no está respaldado 1:1.** Se emiten 150 MXNT contra $100 MXN recibidos. Si todos los tokens se redimen a la par, la tesorería tiene un déficit estructural de $50 por cada $100 ingresados. Ese diferencial es el CAC acordado con la asociación de transporte, lo cual es legítimo, pero **tiene que estar provisionado y contabilizado como pasivo desde el día uno**, no descubierto al final del mes. **Acción: modelo de tesorería con pasivo emitido vs. efectivo recibido, y fuente explícita del subsidio.**

**7.3 Conciliación manual no escala.** Revisar comprobantes de SPEI a mano es correcto para el piloto y es la defensa adecuada contra duplicación de comprobantes, pero se rompe con 50 tiendas. **Acción: migrar a CLABE de referencia única por tiendita, con abono automático conciliado por identificador, conservando aprobación manual solo para excepciones.**

**7.4 Custodia de llaves.** El servidor custodia las llaves privadas de todas las tarjetas y de la tesorería. El sistema es tan seguro como ese almacén. **Acción: HSM o bóveda cifrada real desde el piloto, multisig en la cuenta emisora, y separación estricta entre llave emisora y llave del relayer.**

**7.5 Privacidad y ledger público.** El UID del pasajero y su patrón completo de viajes quedan en un registro público e inmutable. Aunque el UID sea seudónimo, un patrón de viaje diario es reidentificable. Esto interactúa con la LFPDPPP. **Acción: aviso de privacidad, rotación de identificadores y minimización de metadata en el campo ****`Memo`****.**

**7.6 Sin cola offline.** Se decidió que sin internet no se cobra. Es la decisión correcta contra el doble gasto, pero significa pasajes no cobrados en zonas sin cobertura. **Acción: medir en el piloto el porcentaje de intentos fallidos por conectividad antes de decidir si conviene un esquema de firma diferida con límite de riesgo.**

**7.7 Riesgo de reclasificación.** Si el token llegara a circular fuera del circuito —aceptado por un tercero, intercambiado entre personas— podría encuadrar como activo virtual bajo la Ley Fintech, con todo el régimen encima. Las reglas de control de wallets de la sección 5 del plan **no son una optimización técnica: son el núcleo del argumento legal.** Deben tratarse como requisito crítico, no como configuración.

---

## 8. Agenda de investigación pendiente

1. Opinión legal escrita sobre el encuadre del instrumento (Ley Fintech art. 24 vs. LFPIORPI art. 17 fr. II).
2. Alta en el Padrón de Actividades Vulnerables del SAT y documento de lineamientos de identificación dentro de los 90 días de inicio de operación.
3. Tratamiento fiscal de la emisión con descuento: ¿es descuento comercial, gasto de promoción o ingreso diferido? Validar con el contador general de transportes.
4. Régimen aplicable si en el futuro el sistema se extiende a más de un servicio o a comercios (ahí sí se sale del circuito cerrado).
5. Comparativo formal de costo por transacción contra tarifa de agregador, con datos del piloto, para el expediente de licitación.
6. Precedentes: cómo encuadraron su instrumento los sistemas de tarjeta de transporte ya operando en México, y qué figura jurídica usa cada uno.

---

# 9. Plan Final

> Esta sección se conserva sin modificaciones respecto del documento original.

# Infraestructura técnica transportes de Morelos final

# Sistema de Cobro Cerrado (*Closed Loop*) para el Transporte Público de Morelos

Este documento integra la arquitectura técnica, operativa y financiera para la implementación de un sistema de cobro digital para la red de transporte (ej. Ruta 9 y concesionarios locales) en el Estado de Morelos, utilizando la red blockchain **Stellar Network**.

## 1. Visión General del Proyecto

El objetivo es modernizar el pago del pasaje mediante **tarjetas físicas NFC** sin requerir que el usuario final descargue aplicaciones, configure *wallets* ni maneje frases semilla.

Para acelerar la adopción en la red de rutas (Cuernavaca, Temixco, etc.), se implementa un modelo de incentivo comercial con las tiendas de abarrotes locales:

- **Mapeo de Red:** Se seleccionan tienditas estratégicas distribuidas a lo largo del circuito de las rutas.
- **Modelo de Incentivo:** Por cada $100 MXN en dinero real que la tiendita transfiere mediante **SPEI**, se le acreditan **150 Tokens de Transporte ($MXNT)**.
- **Ganancia de la Tiendita:** La tiendita vende esos 150 tokens a los pasajeros en efectivo ($1 MXNT = $1 MXN). Al vender la totalidad de los tokens, la tienda recupera sus $100 MXN de inversión y obtiene **$50 MXN de ganancia**.
- **Impacto Operativo:** Esos $50 MXN adicionales equivalen comercialmente a subsidiar \~3 a 5 pasajes por recarga como costo de adquisición de usuario (CAC) acordado por la asociación de transporte.

## 2. Arquitectura en Stellar Network

Stellar Network se selecciona por sus tiempos de confirmación (3 a 5 segundos), sus comisiones insignificantes ($0.00001 USD) y el soporte nativo de activos digitalizados (*Assets*).

### Estructura de Cuentas y Control

- **Cuenta Emisora (*****Issuer Account*****):** Bóveda multisig administrada por la dirección del proyecto. Es la única cuenta con permisos para crear (*mint*) o destruir (*burn*) el token **`MXNT`**.
- **Cuenta de Tesorería (*****Distributor*****):** Cuenta intermedia que recibe las transferencias bancarias y distribuye los tokens autorizados.
- **Wallets Custodiales para Tarjetas NFC:** Cuentas creadas automáticamente en el servidor para cada tarjeta física en circulación. Mediante el mecanismo de **Patrocinio de Cuentas (*****Sponsorship*****)** de Stellar, la plataforma absorbe las reservas mínimas de XLM para que el usuario opere únicamente con el token `MXNT`.
- **Wallets de Unidades / Concesionarios:** Cuentas asignadas a cada vehículo o concesionario donde cae el cobro de los pasajes.

## 3. Diagrama de Flujo del Sistema (End-to-End)

```txt
 [ TIENDITA ]              [ SERVIDOR / TESORERÍA ]                [ STELLAR NETWORK ]                [ VALIDADOR CAMIÓN ]
      │                               │                                     │                                  │
  1.  ├─ Realiza $100 SPEI ──────────►│                                     │                                  │
      ├─ Sube Comprobante/Ticket      │                                     │                                  │
      │                               │                                     │                                  │
  2.  │                               ├─ Revisa pago en Banco               │                                  │
      │                               ├─ Valida legibilidad de ticket       │                                  │
      │                               │                                     │                                  │
  3.  │                               ├─ Firma y ejecuta Payment ──────────►│                                  │
      │                               │  (150 MXNT)                         ├─ Mint/Transfer 150 MXNT ────────►│ (Aparecen en la
      │                               │                                     │  a Wallet de la Tiendita         │  App de la Tiendita)
      │                               │                                     │                                  │
  4.  ├─ Recibe $20 MXN en efectivo   │                                     │                                  │
      ├─ Escanea Tarjeta NFC Pasajero │                                     │                                  │
      │                               │                                     │                                  │
  5.  │                               ├─ Relayer Server ejecuta:            │                                  │
      │                               │  Payment: Tiendita -> Wallet NFC ──►│                                  │
      │                               │                                     ├─ Transfiere 20 MXNT a Wallet NFC │
      │                               │                                     │                                  │
  6.  │                               │                                     │                                  ├─ Pasajero pasa Tarjeta
      │                               │                                     │                                  │  NFC por el lector
  7.  │                               │◄─ Envía UID + ID de Unidad ──────────────────────────────────────────┤
      │                               │                                     │                                  │
  8.  │                               ├─ Relayer ejecuta Payment con Memo:  │                                  │
      │                               │  • From: Wallet NFC (UID)           │                                  │
      │                               │  • To: Wallet Concesionario         │                                  │
      │                               │  • Memo: "R9|U42|BONO_FIFO" ───────►│                                  │
      │                               │                                     ├─ Confirma Tx (3-5 seg) ─────────►│ Pitido verde y muestra
      │                               │                                     │                                  │ saldo restante al pasajero
```

## 4. Detalle Técnico de los Procesos

### Fase A: Validación Manual y Emisión Regulada de Saldo (*Minting*)

Para evitar ataques de duplicación de comprobantes, la emisión de saldo no es automática por webhook bancario, sino que incluye verificación:

1. **Depósito y Solicitud:** El tendero transfiere $100 MXN por SPEI a la cuenta concentradora del proyecto y adjunta el comprobante/foto en su App POS.
2. **Conciliación:** Un administrador revisa que el pago esté efectivamente acreditado en el portal bancario y aprueba la orden en el *Dashboard*.
3. **Ejecución en Blockchain:** El servidor firma la transacción en Stellar utilizando el *Secret Key* de la cuenta emisora, transfiriendo **150.0000000 ****`MXNT`** a la wallet de la tiendita.

### Fase B: Experiencia del Usuario Final (NFC Custodial Cero-Onboarding)

1. **Naturaleza de la Tarjeta:** La tarjeta del usuario es un chip NFC pasivo (ej. *MIFARE DESFire* o *NTAG213*) que almacena un Identificador Único (`UID`) cifrado. No guarda criptomonedas directamente.
2. **Mapping 1:1:** En el servidor central, cada `UID` está vinculado a una par de llaves (*Public/Private Key*) de Stellar administradas de forma segura en un módulo HSM o Bóveda Cifrada.
3. **Recarga en Tiendita:** La tiendita acerca la tarjeta al teléfono/POS, lee el `UID` y transfiere los tokens `MXNT` desde su cuenta hacia la wallet asignada a dicho `UID`.

### Fase C: Cobro en la Unidad y Trazabilidad del Bono

1. **Lectura y Firma Relayer:**
   - Al subir al camión, el pasajero acerca la tarjeta al validador NFC.
   - El validador lee el `UID` y envía un paquete MQTT/HTTP cifrado al servidor *Relayer*:JSON
     ```txt
     {
       "uid": "04A28F99",
       "monto": 10.00,
       "ruta": "RUTA_09",
       "unidad": "UNIDAD_42"
     }
     ```
   - El servidor *Relayer* construye la transacción en Stellar de la wallet del pasajero a la wallet del concesionario de la Unidad 42.
2. **Rastreo de Métricas mediante el campo ****`Memo`****:**
   
   Para identificar exactamente en qué ruta y unidad se consumieron los $50 tokens regalados como bonificación:
   

   - Cada transacción incluye un parámetro **`Memo`** en Stellar con la metadata de la operación: `R9|U42|LOT_BONO_883`.
   - Un servidor escuchador (*Horizon Event Indexer*) procesa los bloques en tiempo real. Al detectar que los tokens gastados provienen del lote asignado como bono a la tiendita, registra en el panel estadístico el impacto por ruta:

| **Fecha / Hora** | **Tiendita de Origen** | **ID Pasajero (UID)** | **Ruta de Redención** | **Unidad** | **Monto** | **Clasificación de Token** |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-27 10:15 | Abarrotes "Don Pedro" | `UID_04A28F99` | **Ruta 9** | Unidad 14 | $10.00 | Pasaje Estándar |
| 2026-08-27 11:30 | Abarrotes "Don Pedro" | `UID_04A28F99` | **Ruta 9** | Unidad 03 | $10.00 | **Bono Promocional** |
| 2026-08-27 12:05 | Mini Super "Cuernavaca" | `UID_11A99B02` | **Ruta 1** | Unidad 22 | $10.00 | **Bono Promocional** |

## 5. Reglas de Control de las Wallets

Para mantener la integridad de este sistema cerrado (*closed loop*), las cuentas en Stellar operan bajo las siguientes restricciones lógicas configuradas en los contratos/servidor:

- **Cuenta Tiendita:** Únicamente tiene habilitadas transferencias dirigidas a cuentas clasificadas como **`PASAJERO`** (Tarjetas NFC).
- **Tarjeta NFC (Pasajero):** Únicamente puede realizar transferencias hacia cuentas clasificadas como **`UNIDAD_VALIDADOR`**.
- **Unidad / Concesionario:** Acumula el saldo cobrado. Al final de la jornada o periodo contable, solicita la liquidación bancaria SPEI a la administración; al transferir los tokens de vuelta a la Tesorería para su cobro, estos son **quemados (*****burn*****)** de la red.

### Justificación

Esta infraestructura requiere menos capacidad operativa en la parte tecnológica. Adicionalmente, se habló con el contador general de transportes para su implementación piloto. Se desarrollará este sistema y se harán pruebas controladas las semanas del 31 de agosto al 4 de septiembre de 2026 para su evaluación.

### Plan de trabajo

Daniel desarrollará el sistema para un MVP sin entrar a detalles técnicos. Sin embargo, se debe considerar un plan completo para integrar SCF y escalabilidad técnica completa.

---

## Fuentes consultadas

- Ley para Regular las Instituciones de Tecnología Financiera (DOF, 09/03/2018) — arts. 22, 23, 24. https://dof.gob.mx/nota\_detalle.php?codigo=5515623&fecha=09%2F03%2F2018
- Banco de México, Circular 4/2019, operaciones con activos virtuales. https://www.dof.gob.mx/nota\_detalle.php?codigo=5552303&fecha=08/03/2019
- SAT, Actividades Vulnerables — umbrales por fracción. https://sppld.sat.gob.mx/pld/interiores/umbrales.html
- SAT, folleto fracción II (tarjetas prepagadas e instrumentos de almacenamiento de valor monetario). https://www.sat.gob.mx/minisitio/ActividadesVulnerables/documentos/Formatos/Fraccion\_II\_monederos/folleto.pdf
- Banco de México, cuotas de intercambio y tasas de descuento. https://www.banxico.org.mx/sistemas-de-pago/cuotas-intercambio-comisiones.html
- Reforma LFPIORPI (DOF, 16/07/2025) y Reglamento (DOF, 27/03/2026) — resumen de umbrales 2026. https://kyc-systems.com/blog/umbrales-lfpiorpi-2026
- Bitso Business / Juno, MXNB. https://bitso.com/mx/business/products/mxnb-stablecoin
- CONDUSEF, qué pueden y no pueden hacer las IFPE. https://www.condusef.gob.mx/?p=contenido&idc=2053&idcat=1

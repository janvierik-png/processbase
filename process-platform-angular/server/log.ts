/**
 * SEC-01f (#32) — logy servera bez obsahu.
 *
 * Sprava chyby (Prisma, SMTP, prekladac) moze obsahovat casti dotazu, e-mailove
 * adresy alebo text procesov — do logu nejde. Zapise sa len druh chyby, jej kod,
 * ID poziadavky a riadky zasobnika (subor:riadok), ktore ukazuju miesto v kode,
 * nie data. Logy sa kopiruju dalej (CI, hosting, podpora), preto plati aj lokalne.
 */

/** Druh chyby: nazov triedy a strojovy kod (P2002, ECONNREFUSED, 503…). */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const parts = [error.name];
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) parts.push(code);
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') parts.push(String(status));
  return parts.join(' ');
}

/**
 * Riadky zasobnika bez prveho riadku (ten nesie spravu chyby). Prednost ma
 * miesto v nasom kode (server/) — riadky z kniznic samotne malo povedia.
 */
export function stackFrames(error: unknown, limit = 4): string[] {
  if (!(error instanceof Error) || !error.stack) return [];
  // V8 zacina zasobnik textom „Nazov: sprava“ — viacriadkova sprava by inak
  // mohla podstrcit riadok, ktory vyzera ako miesto v kode
  const head = String(error);
  const stack = error.stack.startsWith(head) ? error.stack.slice(head.length) : error.stack.split('\n').slice(1).join('\n');
  const frames = stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^at [\w$.<>\[\] ]*\(?(file:\/\/|\/|node:|[A-Za-z]:\\)[^\s()]*:\d+:\d+\)?$/.test(line))
    // absolutne cesty skratit — staci subor v repozitari
    .map((line) => line.replace(/(file:\/\/)?\/[^\s()]*\/(server|node_modules)\//, '$2/'));
  const ours = frames.filter((line) => line.includes('server/'));
  return [...new Set([frames[0], ...ours, ...frames].filter(Boolean))].slice(0, limit);
}

export function logError(scope: string, error: unknown, requestId?: string): void {
  const frames = stackFrames(error);
  const where = frames.length > 0 ? ` @ ${frames.join(' < ')}` : '';
  console.error(`[${scope}]${requestId ? ` req=${requestId}` : ''} ${describeError(error)}${where}`);
}

const INBOUND_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** ID od reverznej proxy prevezmeme len v bezpecnom tvare (ziadne nove riadky ani obsah). */
export function acceptRequestId(inbound: unknown, generate: () => string): string {
  return typeof inbound === 'string' && INBOUND_REQUEST_ID.test(inbound) ? inbound : generate();
}

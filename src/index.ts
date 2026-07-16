export { PlasmaCard } from "./client.js";
export type { PlasmaCardOptions, PlasmaCardAuth } from "./client.js";
export { EmailAuth } from "./auth/email.js";
export { SessionStore } from "./auth/session.js";
export type { PlasmaSession } from "./auth/session.js";

export { HttpClient, IDEMPOTENT_METHODS } from "./http.js";
export type { HttpOptions, RequestOptions } from "./http.js";

export { PlasmaAccount } from "./resources/account.js";
export type { TransactionListParams } from "./resources/account.js";

export { parseMoney, directionSign, signedAmount, transactionDate, isBookable } from "./money.js";

export {
  PlasmaError,
  ApiError,
  AuthError,
  RateLimitError,
  ValidationError,
  NetworkError,
  TimeoutError,
} from "./errors.js";

export {
  PLASMA_BASE,
  PLASMA_WS,
  PRIVY_APP_ID,
  PRIVY_CLIENT_ID,
  ENDPOINTS,
  AUTH_SCHEME,
  DEFAULTS,
} from "./constants.js";

export * from "./types.js";

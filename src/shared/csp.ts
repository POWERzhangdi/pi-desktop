/**
 * Content-Security-Policy 策略(主进程与构建脚本共用一份,避免两处漂移)。
 *
 * 开发:需要放行 vite HMR 的内联脚本与本地 websocket;
 * 生产:收紧到 self,并禁掉 object/base-uri/form-action。
 */
export const DEV_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*",
].join("; ");

export const PROD_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ");

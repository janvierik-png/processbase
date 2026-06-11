// Dev proxy: na hoste smeruje na 127.0.0.1:3000 (API platformy),
// v Docker kontajneri nastavuje compose API_PROXY_TARGET=http://api:3000
const target = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
    logLevel: 'warn'
  }
};

export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['phone', 'phone_e164', 'email', 'cnic', 'otp', 'code', 'password', 'token', 'refreshToken', 'accessToken', 'authorization', 'req.headers.authorization', 'req.body.phone', 'req.body.email', 'req.body.otp', 'req.body.code', 'req.body.password', 'address', '*.phone', '*.email', '*.cnic', '*.otp', '*.password', '*.token'],
    censor: '[REDACTED]'
  }
};

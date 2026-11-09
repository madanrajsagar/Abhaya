const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
const logFilePath = path.join(logsDir, 'backend.log');

fs.mkdirSync(logsDir, { recursive: true });

const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

const redactValue = (key, value) => {
  if (value === undefined || value === null) {
    return value;
  }

  const lowerKey = String(key).toLowerCase();
  const sensitiveKeys = [
    'password',
    'token',
    'authorization',
    'secret',
    'privatekey',
    'private_key',
  ];

  if (sensitiveKeys.some((sensitiveKey) => lowerKey.includes(sensitiveKey))) {
    return '[redacted]';
  }

  return value;
};

const sanitizeDetails = (details = {}) =>
  Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, redactValue(key, value)])
  );

const formatLine = (level, message, details = {}) => {
  const timestamp = new Date().toISOString();
  const safeDetails = sanitizeDetails(details);
  const detailsSuffix =
    Object.keys(safeDetails).length > 0 ? ` ${JSON.stringify(safeDetails)}` : '';

  return `[${timestamp}] [${level}] ${message}${detailsSuffix}`;
};

const writeLine = (level, message, details = {}) => {
  const line = formatLine(level, message, details);
  logStream.write(`${line}\n`);

  if (level === 'ERROR') {
    console.error(line);
    return;
  }

  if (level === 'WARN') {
    console.warn(line);
    return;
  }

  console.log(line);
};

const maskEmail = (email = '') => {
  if (!email || !email.includes('@')) {
    return email;
  }

  const [name, domain] = email.split('@');
  if (name.length <= 2) {
    return `${name[0] || '*'}*@${domain}`;
  }

  return `${name.slice(0, 2)}***@${domain}`;
};

module.exports = {
  logFilePath,
  maskEmail,
  info: (message, details) => writeLine('INFO', message, details),
  warn: (message, details) => writeLine('WARN', message, details),
  error: (message, details) => writeLine('ERROR', message, details),
};

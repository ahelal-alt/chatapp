const ApiError = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
}

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const payload = {
    success: false,
    message: err.message || 'Internal server error',
  };

  if (err.errors?.length) {
    payload.errors = err.errors;
  }

  if (!err.statusCode && req.app.get('env') !== 'production') {
    payload.stack = err.stack;
  }

  res.status(statusCode).json(payload);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};


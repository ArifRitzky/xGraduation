class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Meneruskan error dari fungsi async ke error handler Express.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { HttpError, asyncHandler };

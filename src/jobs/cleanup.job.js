const User = require('../modules/users/user.model');

async function runCleanupJob() {
  await User.updateMany(
    {
      resetPasswordExpiresAt: { $lt: new Date() },
    },
    {
      $unset: {
        resetPasswordToken: 1,
        resetPasswordExpiresAt: 1,
      },
    },
  );
}

module.exports = {
  runCleanupJob,
};


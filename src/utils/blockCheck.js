const Block = require('../modules/blocks/block.model');
const ApiError = require('./ApiError');

async function isBlocked(userIdA, userIdB) {
  const block = await Block.findOne({
    $or: [
      { blockerUserId: userIdA, blockedUserId: userIdB },
      { blockerUserId: userIdB, blockedUserId: userIdA },
    ],
  }).lean();

  return Boolean(block);
}

async function assertNotBlocked(userIdA, userIdB, message = 'Action not allowed because one of the users is blocked') {
  if (await isBlocked(userIdA, userIdB)) {
    throw new ApiError(403, message);
  }
}

module.exports = {
  isBlocked,
  assertNotBlocked,
};


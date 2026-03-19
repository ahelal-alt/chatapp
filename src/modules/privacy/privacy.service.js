const PrivacySettings = require('./privacy.model');

async function getPrivacySettings(userId) {
  let privacy = await PrivacySettings.findOne({ userId });

  if (!privacy) {
    privacy = await PrivacySettings.create({ userId });
  }

  return privacy;
}

async function updatePrivacySettings(userId, payload) {
  const privacy = await PrivacySettings.findOneAndUpdate(
    { userId },
    payload,
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  return privacy;
}

module.exports = {
  getPrivacySettings,
  updatePrivacySettings,
};


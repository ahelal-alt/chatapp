const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const privacyService = require('./privacy.service');

const getPrivacy = asyncHandler(async (req, res) => {
  const privacy = await privacyService.getPrivacySettings(req.user._id);
  res.json(new ApiResponse('Privacy settings fetched successfully', privacy));
});

const updatePrivacy = asyncHandler(async (req, res) => {
  const privacy = await privacyService.updatePrivacySettings(req.user._id, req.body);
  res.json(new ApiResponse('Privacy settings updated successfully', privacy));
});

module.exports = {
  getPrivacy,
  updatePrivacy,
};


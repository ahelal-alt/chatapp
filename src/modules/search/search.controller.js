const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./search.service');

const searchWorkspace = asyncHandler(async (req, res) => {
  const result = await service.searchWorkspace(req.user._id, req.query);
  res.json(new ApiResponse('Search results fetched successfully', result));
});

module.exports = {
  searchWorkspace,
};

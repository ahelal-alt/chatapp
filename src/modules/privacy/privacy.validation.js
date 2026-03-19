const { body } = require('express-validator');

const updatePrivacyValidation = [
  body('messagePermission').optional().isIn(['everyone', 'contacts']),
  body('profilePhotoVisibility').optional().isIn(['everyone', 'contacts', 'nobody']),
  body('lastSeenVisibility').optional().isIn(['everyone', 'contacts', 'nobody']),
  body('onlineStatusVisibility').optional().isIn(['everyone', 'contacts', 'nobody']),
  body('groupInvitePermission').optional().isIn(['everyone', 'contacts']),
  body('readReceiptsEnabled').optional().isBoolean(),
  body('typingIndicatorEnabled').optional().isBoolean(),
];

module.exports = {
  updatePrivacyValidation,
};


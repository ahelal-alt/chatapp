function auditLog(action, actorId, details = {}) {
  const payload = {
    action,
    actorId,
    details,
    at: new Date().toISOString(),
  };

  console.info('[AUDIT]', JSON.stringify(payload));
}

module.exports = auditLog;


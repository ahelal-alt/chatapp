const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const env = require('../config/env');
const auditLog = require('./audit');

let transport;
let resendClient;

function getEmailProvider() {
  return String(env.email.provider || 'smtp').toLowerCase();
}

function isResendConfigured() {
  return Boolean(env.email.resendApiKey && env.email.resendFrom);
}

function isOauth2Configured() {
  return Boolean(
    env.smtp.host
      && env.smtp.port
      && env.smtp.user
      && (env.smtp.from || env.smtp.user)
      && env.smtp.oauth2.clientId
      && env.smtp.oauth2.clientSecret
      && (env.smtp.oauth2.refreshToken || env.smtp.oauth2.accessToken),
  );
}

function isSmtpConfigured() {
  if (String(env.smtp.authMethod).toLowerCase() === 'oauth2') {
    return isOauth2Configured();
  }

  return Boolean(env.smtp.host && env.smtp.port && env.smtp.user && env.smtp.pass && (env.smtp.from || env.smtp.user));
}

function isEmailConfigured() {
  return getEmailProvider() === 'resend' ? isResendConfigured() : isSmtpConfigured();
}

function getTransport() {
  if (!isSmtpConfigured()) {
    return null;
  }

  if (!transport) {
    const port = Number(env.smtp.port);
    const useOauth2 = String(env.smtp.authMethod).toLowerCase() === 'oauth2';
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: useOauth2
        ? {
          type: 'OAuth2',
          user: env.smtp.user,
          clientId: env.smtp.oauth2.clientId,
          clientSecret: env.smtp.oauth2.clientSecret,
          refreshToken: env.smtp.oauth2.refreshToken || undefined,
          accessToken: env.smtp.oauth2.accessToken || undefined,
        }
        : {
          user: env.smtp.user,
          pass: env.smtp.pass,
        },
    });
  }

  return transport;
}

function getResendClient() {
  if (!isResendConfigured()) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(env.email.resendApiKey);
  }

  return resendClient;
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const [name, domain] = value.split('@');
  if (!name || !domain) {
    return '';
  }

  return `${name.slice(0, 2)}***@${domain}`;
}

function getConfigurationFailureReason() {
  if (getEmailProvider() === 'resend') {
    return isResendConfigured() ? '' : 'resend_not_configured';
  }

  if (!env.smtp.host || !env.smtp.port || !env.smtp.user || !(env.smtp.from || env.smtp.user)) {
    return 'smtp_not_configured';
  }

  if (String(env.smtp.authMethod).toLowerCase() === 'oauth2') {
    return isOauth2Configured() ? '' : 'smtp_oauth2_not_configured';
  }

  return env.smtp.pass ? '' : 'smtp_password_not_configured';
}

function wrapHtml({ heading, intro, body, ctaLabel, ctaUrl, footer }) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:32px;color:#111827;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:32px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#4f46e5;text-transform:uppercase;">${env.appName}</div>
        <h1 style="margin:12px 0 8px;font-size:24px;line-height:1.3;">${heading}</h1>
        <p style="margin:0 0 16px;color:#4b5563;line-height:1.7;">${intro}</p>
        <div style="margin:16px 0;color:#111827;line-height:1.7;">${body}</div>
        ${ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:16px;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600;">${ctaLabel}</a>` : ''}
        <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.7;">${footer}</p>
      </div>
    </div>
  `;
}

async function sendMail(message, options = {}) {
  const actorId = options.actorId || null;
  const category = options.category || 'general';

  if (!isEmailConfigured()) {
    const reason = getConfigurationFailureReason() || 'smtp_not_configured';
    auditLog('email.skipped', actorId, {
      category,
      reason,
      recipient: maskEmail(message.to),
    });

    return {
      status: 'skipped',
      configured: false,
      recipient: maskEmail(message.to),
      reason,
    };
  }

  try {
    let providerMessageId = '';
    const provider = getEmailProvider();

    if (provider === 'resend') {
      const response = await getResendClient().emails.send({
        from: env.email.resendFrom,
        to: Array.isArray(message.to) ? message.to : [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      providerMessageId = response?.data?.id || response?.id || '';
    } else {
      const info = await getTransport().sendMail({
        from: env.smtp.from || env.smtp.user,
        ...message,
      });
      providerMessageId = info.messageId || '';
    }

    auditLog('email.sent', actorId, {
      category,
      recipient: maskEmail(message.to),
      provider,
      messageId: providerMessageId,
    });

    return {
      status: 'sent',
      configured: true,
      recipient: maskEmail(message.to),
      provider,
      messageId: providerMessageId,
    };
  } catch (error) {
    auditLog('email.failed', actorId, {
      category,
      recipient: maskEmail(message.to),
      code: error?.code || '',
    });

    console.error('[EMAIL]', JSON.stringify({
      category,
      recipient: maskEmail(message.to),
      provider: getEmailProvider(),
      code: error?.code || '',
      message: error?.message || 'Mail delivery failed',
    }));

    return {
      status: 'failed',
      configured: true,
      recipient: maskEmail(message.to),
      reason: 'delivery_failed',
    };
  }
}

function buildVerificationUrl(token) {
  return `${String(env.clientUrl || '').replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
}

function buildResetUrl(token) {
  return `${String(env.clientUrl || '').replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail({ to, fullName, token, actorId = null }) {
  const actionUrl = buildVerificationUrl(token);
  const displayName = String(fullName || '').trim() || 'there';

  return sendMail({
    to,
    subject: `Verify your ${env.appName} account`,
    text: [
      `Hi ${displayName},`,
      '',
      `Verify your ${env.appName} account using this link:`,
      actionUrl,
      '',
      `Verification code: ${token}`,
    ].join('\n'),
    html: wrapHtml({
      heading: 'Verify your email',
      intro: `Hi ${displayName}, please confirm your email address to activate your ${env.appName} account.`,
      body: `<p>Your verification code is <strong>${token}</strong>.</p><p>You can also use the button below.</p>`,
      ctaLabel: 'Verify Email',
      ctaUrl: actionUrl,
      footer: 'If you did not create this account, you can safely ignore this email.',
    }),
  }, {
    actorId,
    category: 'email_verification',
  });
}

async function sendPasswordResetEmail({ to, fullName, token, actorId = null }) {
  const actionUrl = buildResetUrl(token);
  const displayName = String(fullName || '').trim() || 'there';

  return sendMail({
    to,
    subject: `Reset your ${env.appName} password`,
    text: [
      `Hi ${displayName},`,
      '',
      'Use this link to reset your password:',
      actionUrl,
      '',
      `Reset code: ${token}`,
    ].join('\n'),
    html: wrapHtml({
      heading: 'Reset your password',
      intro: `Hi ${displayName}, we received a request to reset your ${env.appName} password.`,
      body: `<p>Your reset code is <strong>${token}</strong>.</p><p>If you requested this, continue with the button below.</p>`,
      ctaLabel: 'Reset Password',
      ctaUrl: actionUrl,
      footer: 'If you did not request this, you can ignore this email and your password will stay unchanged.',
    }),
  }, {
    actorId,
    category: 'password_reset',
  });
}

async function sendInviteEmail({ to, inviteUrl, inviterName, actorId = null }) {
  const displayName = String(inviterName || '').trim() || 'A teammate';

  return sendMail({
    to,
    subject: `${displayName} invited you to join ${env.appName}`,
    text: [
      `${displayName} invited you to join ${env.appName}.`,
      '',
      'Open this invite link to continue:',
      inviteUrl,
    ].join('\n'),
    html: wrapHtml({
      heading: 'You have been invited',
      intro: `${displayName} invited you to join ${env.appName}.`,
      body: '<p>Open the invite link below to sign in or create your account and join the workspace.</p>',
      ctaLabel: 'Open Invite',
      ctaUrl: inviteUrl,
      footer: 'If you were not expecting this invitation, you can ignore this email.',
    }),
  }, {
    actorId,
    category: 'workspace_invite',
  });
}

module.exports = {
  isSmtpConfigured,
  isEmailConfigured,
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendInviteEmail,
};

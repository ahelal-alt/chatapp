# Stitch Screen To Backend Map

This document maps the Stitch export in `/Users/helal/Downloads/stitch` to the current backend in this project.

Status legend:
- `READY`: backend endpoints and data contracts are already present for implementation
- `PARTIAL`: backend is usable, but the screen may need composition, generic data, or frontend assumptions
- `UI-ONLY`: the screen is a frontend state and does not need a dedicated backend endpoint

Base API prefix: `/api/v1`

## Shared realtime dependencies

Most messaging screens should also use the socket layer:

- `chat:join`
- `chat:leave`
- `message:send`
- `message:typing`
- `message:stop-typing`
- `message:seen`
- `message:delivered`
- `presence:update`
- `notification:read`
- `notification:read-all`

Call screens additionally use:

- `call:create`
- `call:sync`
- `call:accept`
- `call:reject`
- `call:join`
- `call:state`
- `call:leave`
- `call:end`
- `call:signal:offer`
- `call:signal:answer`
- `call:signal:ice-candidate`

## Auth screens

### `pulsechat_login`
Status: `READY`

Endpoints:
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /auth/me`

Useful follow-ups:
- `POST /auth/logout`

### `pulsechat_register`
Status: `READY`

Endpoints:
- `POST /auth/register`
- `POST /auth/verify-email`
- `POST /auth/resend-verification`

### `pulsechat_forgot_password`
Status: `READY`

Endpoints:
- `POST /auth/forgot-password`

### `pulsechat_reset_password`
Status: `READY`

Endpoints:
- `POST /auth/reset-password`

### `pulsechat_email_verification`
Status: `READY`

Endpoints:
- `POST /auth/verify-email`
- `POST /auth/resend-verification`

### `email_verification_success`
Status: `UI-ONLY`

Notes:
- driven by success response from `POST /auth/verify-email`

### `email_verification_success_redesign`
Status: `UI-ONLY`

Notes:
- alternate success presentation for the same verification flow

### `email_verification_failure_states`
Status: `UI-ONLY`

Notes:
- driven by 4xx responses from `POST /auth/verify-email`

### `password_reset_success`
Status: `UI-ONLY`

Notes:
- driven by success response from `POST /auth/reset-password`

### `pulsechat_reset_token_invalid_expired`
Status: `UI-ONLY`

Notes:
- driven by 4xx responses from `POST /auth/reset-password`

### `session_expired_modal`
Status: `UI-ONLY`

Notes:
- driven by `401` auth failures and refresh failure

### `unauthorized_access`
Status: `UI-ONLY`

Notes:
- driven by `401` / `403` route failures

### `access_denied_page`
Status: `UI-ONLY`

Notes:
- driven by `403` route failures, especially admin-only routes

### `suspended_account`
Status: `UI-ONLY`

Notes:
- backend returns account-state failures from auth flows

## Workspace and shell

### `pulsechat_main_workspace`
Status: `READY`

Endpoints:
- `GET /auth/me`
- `GET /chats`
- `GET /notifications`
- `GET /users/me`

Sockets:
- presence, chat, notifications

### `pulsechat_main_messenger`
Status: `READY`

Endpoints:
- `GET /chats`
- `GET /chats/:chatId`
- `GET /messages/chat/:chatId`
- `POST /messages`

Sockets:
- chat events
- presence events

### `onboarding_getting_started`
Status: `UI-ONLY`

Notes:
- can be driven from empty results of `/chats`, `/contacts`, and `/groups`

### `404_not_found`
Status: `UI-ONLY`

### `pulsechat_maintenance_page`
Status: `UI-ONLY`

## Chat list and conversation

### `pulsechat_chat_list_states`
Status: `READY`

Endpoints:
- `GET /chats`

Useful query params:
- `page`
- `limit`
- `archived`
- `muted`
- `pinned`
- `type`
- `q`

### `archived_chats_management`
Status: `READY`

Endpoints:
- `GET /chats?archived=true`
- `PUT /chats/:chatId/unarchive`

### `pinned_and_muted_chats_management`
Status: `READY`

Endpoints:
- `GET /chats?pinned=true`
- `GET /chats?muted=true`
- `PUT /chats/:chatId/unpin`
- `PUT /chats/:chatId/unmute`

### `pulsechat_active_conversation`
Status: `READY`

Endpoints:
- `GET /chats/:chatId`
- `GET /messages/chat/:chatId`
- `POST /messages`
- `PUT /messages/:messageId/seen`
- `PUT /messages/:messageId/delivered`

Sockets:
- `chat:join`
- `chat:leave`
- `message:send`
- `message:typing`
- `message:stop-typing`
- `message:seen`
- `message:delivered`

### `pulsechat_empty_conversation`
Status: `UI-ONLY`

Notes:
- driven by empty `GET /messages/chat/:chatId` result

### `pulsechat_loading_conversation`
Status: `UI-ONLY`

### `pulsechat_loading_skeleton_states`
Status: `UI-ONLY`

### `pulsechat_message_system`
Status: `READY`

Endpoints:
- `POST /messages`
- `PUT /messages/:messageId`
- `DELETE /messages/:messageId`
- `DELETE /messages/:messageId/for-me`
- `POST /messages/:messageId/reply`
- `POST /messages/:messageId/forward`
- `POST /messages/:messageId/reactions`
- `DELETE /messages/:messageId/reactions`
- `PUT /messages/:messageId/pin`
- `DELETE /messages/:messageId/pin`

### `message_status_system`
Status: `READY`

Endpoints:
- `POST /messages`
- `PUT /messages/:messageId/seen`
- `PUT /messages/:messageId/delivered`

Notes:
- queued, sending, failed, retry are frontend/offline-state concerns layered on top

### `delete_message_confirmation`
Status: `UI-ONLY`

Notes:
- submit to:
  - `DELETE /messages/:messageId`
  - `DELETE /messages/:messageId/for-me`

### `pinned_messages_panel`
Status: `READY`

Endpoints:
- `GET /messages/chat/:chatId/pinned`
- `PUT /messages/:messageId/pin`
- `DELETE /messages/:messageId/pin`

### `search_in_conversation_view`
Status: `READY`

Endpoints:
- `GET /messages/chat/:chatId/search?q=...`

### `pulsechat_redesigned_composer_states`
Status: `READY`

Endpoints:
- `POST /messages`
- `POST /uploads/chat-media`

Sockets:
- `message:typing`
- `message:stop-typing`
- `message:send`

### `offline_and_reconnecting_states`
Status: `UI-ONLY`

Notes:
- backend already supports idempotent send with `clientMessageId`
- UI drives the outbox and reconnect states

### `pulsechat_error_states_overview`
Status: `UI-ONLY`

## Voice, upload, and media

### `pulsechat_premium_voice_interface`
Status: `READY`

Endpoints:
- `POST /uploads/chat-media`
- `POST /messages`

Notes:
- backend supports voice uploads and message persistence

### `voice_recording_permission_denied_state`
Status: `UI-ONLY`

### `voice_recording_unsupported_browser_state`
Status: `UI-ONLY`

### `upload_progress_states`
Status: `UI-ONLY`

Notes:
- driven by frontend upload progress while calling `POST /uploads/chat-media`

### `upload_failure_states_overview`
Status: `UI-ONLY`

Notes:
- driven by upload failure responses from `POST /uploads/chat-media`

### `pulsechat_shared_files_hub`
Status: `READY`

Endpoints:
- `GET /messages/files`

Supported filters:
- `kind`
- `chatId`
- `senderId`
- `from`
- `to`
- `q`
- pagination

### `shared_media_hub`
Status: `READY`

Endpoints:
- `GET /messages/chat/:chatId/media`

### `pulsechat_file_audio_preview`
Status: `READY`

Endpoints:
- `GET /messages/:messageId/media`

### `pulsechat_image_viewer_light`
Status: `READY`

Endpoints:
- `GET /messages/:messageId/media`

### `pulsechat_video_viewer_dark`
Status: `READY`

Endpoints:
- `GET /messages/:messageId/media`

Notes:
- richer metadata exists for images/audio/video/PDF where practical
- video thumbnail generation is still best-effort rather than guaranteed

## Encrypted and private chat details

### `pulsechat_encrypted_private_chat`
Status: `READY`

Endpoints:
- `GET /chats`
- `GET /chats/:chatId`
- `GET /messages/chat/:chatId`
- `POST /messages`
- `GET /users/:userId/encryption-key`
- `PUT /users/me/encryption-key`

### `encrypted_chat_recovery`
Status: `UI-ONLY`

Notes:
- driven by decrypt failure states from the frontend crypto layer

### `pulsechat_private_chat_details_drawer`
Status: `READY`

Endpoints:
- `GET /users/:userId/profile`
- `GET /users/:userId/mutual-contacts`
- `GET /messages/chat/:chatId/media`
- `POST /blocks/:userId`
- `DELETE /blocks/:userId`
- `POST /reports/user/:userId`

## Contacts, requests, and discovery

### `pulsechat_contacts_list`
Status: `READY`

Endpoints:
- `GET /contacts`
- `GET /contacts/recent`
- `GET /users/search?q=...`
- `POST /chats/private/:userId`

### `pulsechat_contacts_states`
Status: `READY`

Endpoints:
- `GET /contacts`
- `POST /contacts/:contactUserId/favorite`
- `DELETE /contacts/:contactUserId/favorite`
- `POST /contacts/:contactUserId/mute`
- `DELETE /contacts/:contactUserId/mute`
- `DELETE /contacts/:contactUserId`

### `pulsechat_contact_requests`
Status: `READY`

Endpoints:
- `GET /contact-requests/incoming`
- `GET /contact-requests/outgoing`
- `POST /contact-requests`
- `PUT /contact-requests/:requestId/accept`
- `PUT /contact-requests/:requestId/reject`
- `PUT /contact-requests/:requestId/cancel`

### `blocked_users_management`
Status: `READY`

Endpoints:
- `GET /blocks`
- `POST /blocks/:userId`
- `DELETE /blocks/:userId`

### `invite_discover_people`
Status: `PARTIAL`

Endpoints:
- `GET /users/search?q=...`
- `GET /search?q=...`
- `GET /contacts`
- `GET /contacts/recent`
- `POST /contact-requests`
- `POST /invites`

Notes:
- backend supports search/invite/request actions
- there is no dedicated recommendation or “people you may know” endpoint

## Groups

### `pulsechat_groups_list`
Status: `READY`

Endpoints:
- `GET /groups`

### `create_group_flow`
Status: `READY`

Endpoints:
- `POST /groups`
- `POST /uploads/profile-image` if you want to reuse upload flow for group imagery after adaptation

### `pulsechat_group_management`
Status: `READY`

Endpoints:
- `GET /groups/:groupId`
- `PUT /groups/:groupId`
- `DELETE /groups/:groupId`
- `POST /groups/:groupId/members`
- `DELETE /groups/:groupId/members/:userId`
- `PUT /groups/:groupId/members/:userId/promote`
- `PUT /groups/:groupId/members/:userId/demote`
- `PUT /groups/:groupId/members/:userId/transfer-ownership`
- `POST /groups/:groupId/leave`

### `group_details_drawer`
Status: `READY`

Endpoints:
- `GET /groups/:groupId`
- `GET /messages/chat/:chatId/media`

### `group_invite_management`
Status: `READY`

Endpoints:
- `POST /groups/:groupId/invite-code`

### `group_join_requests_management`
Status: `READY`

Endpoints:
- `GET /groups/:groupId/join-requests`
- `PUT /groups/:groupId/join-requests/:requestId/approve`
- `PUT /groups/:groupId/join-requests/:requestId/reject`

### `join_group_by_invite_code_states`
Status: `READY`

Endpoints:
- `POST /groups/join/:inviteCode`

## Notifications and search

### `pulsechat_notifications_center`
Status: `READY`

Endpoints:
- `GET /notifications`
- `GET /notifications/:notificationId`
- `PUT /notifications/:notificationId/read`
- `PUT /notifications/read-all`

Sockets:
- notification updates

### `notification_action_details`
Status: `READY`

Endpoints:
- `GET /notifications/:notificationId`

Notes:
- detail response is hydrated with actor, target, context, and route hints

### `pulsechat_global_search_results`
Status: `READY`

Endpoints:
- `GET /search?q=...`

Search coverage:
- users
- chats
- groups
- messages
- files
- notifications
- reports
- contact requests

## Profile, privacy, and security

### `pulsechat_user_profile_settings`
Status: `READY`

Endpoints:
- `GET /users/me`
- `PUT /users/me`
- `PUT /users/me/profile-image`
- `POST /uploads/profile-image`

### `pulsechat_privacy_settings`
Status: `READY`

Endpoints:
- `GET /privacy`
- `PUT /privacy`

### `security_and_sessions`
Status: `READY`

Endpoints:
- `GET /auth/sessions`
- `DELETE /auth/sessions/:sessionId`
- `POST /auth/logout-all`
- `GET /auth/me`

### `change_password_settings`
Status: `READY`

Endpoints:
- `PUT /auth/change-password`

### `deactivate_or_delete_account`
Status: `READY`

Endpoints:
- `POST /auth/deactivate-account`
- `POST /auth/delete-account`

### `logout_all_devices_confirmation_1`
Status: `UI-ONLY`

Notes:
- submits to `POST /auth/logout-all`

### `logout_all_devices_confirmation_2`
Status: `UI-ONLY`

Notes:
- alternate presentation of the same flow

## Invites and teammate onboarding

### `invite_teammates_share_workspace`
Status: `PARTIAL`

Endpoints:
- `GET /invites`
- `POST /invites`
- `GET /invites/:inviteId`
- `POST /invites/:inviteId/resend`
- `DELETE /invites/:inviteId`
- `GET /invites/public/:token`
- `POST /invites/public/:token/register`
- `POST /invites/public/:token/login`
- `POST /invites/public/:token/accept`

Notes:
- invite flow is fully implemented
- “workspace” is currently app-level summary data, not a true tenant model

## Admin and moderation

### `pulsechat_admin_dashboard`
Status: `READY`

Endpoints:
- `GET /admin/dashboard`
- `GET /admin/analytics`

### `pulsechat_admin_reports_hub`
Status: `READY`

Endpoints:
- `GET /admin/reports`
- `GET /admin/reports/:reportId`
- `PUT /admin/reports/:reportId`

### `admin_analytics_deep_dive`
Status: `READY`

Endpoints:
- `GET /admin/analytics`

### `admin_user_detail`
Status: `READY`

Endpoints:
- `GET /admin/users/:userId`
- `PUT /admin/users/:userId/suspend`
- `PUT /admin/users/:userId/activate`

### `report_review_detail`
Status: `READY`

Endpoints:
- `GET /admin/reports/:reportId`
- `PUT /admin/reports/:reportId`

### `report_content_modal_states`
Status: `READY`

Endpoints:
- `POST /reports/user/:userId`
- `POST /reports/message/:messageId`

## Calling

### `active_call_workspace`
Status: `PARTIAL`

REST endpoints:
- `POST /calls`
- `GET /calls`
- `GET /calls/:callId`
- `POST /calls/:callId/accept`
- `POST /calls/:callId/reject`
- `POST /calls/:callId/join`
- `POST /calls/:callId/state`
- `GET /calls/:callId/sync`
- `POST /calls/:callId/leave`
- `POST /calls/:callId/end`

Sockets:
- all `call:*` events listed at the top of this document

Notes:
- backend is signaling-ready for 1:1 and small-group call UIs
- frontend still needs WebRTC peer logic and STUN/TURN configuration

## Summary

Implementation priority:

1. Auth and public invite onboarding
2. Main workspace shell
3. Chat list, conversation, composer, files, notifications
4. Contacts and requests
5. Groups
6. Profile, privacy, security
7. Admin
8. Calls

The only screens that are meaningfully `PARTIAL` from a backend perspective are:
- `invite_teammates_share_workspace`
- `invite_discover_people`
- `active_call_workspace`

Everything else is either backend-ready now or is a frontend-only state screen.

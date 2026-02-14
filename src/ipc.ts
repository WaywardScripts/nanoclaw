import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
} from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
}

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await deps.sendMessage(
                    data.chatJid,
                    `${ASSISTANT_NAME}: ${data.text}`,
                  );
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain, deps);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroupMetadata(true);
        // Write updated snapshot immediately
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'send_gmail':
      await processSendGmail(data as any, sourceGroup);
      break;

    case 'list_calendar_events':
      await processListCalendarEvents(data as any, sourceGroup);
      break;

    case 'get_calendar_event':
      await processGetCalendarEvent(data as any, sourceGroup);
      break;

    case 'create_calendar_event':
      await processCreateCalendarEvent(data as any, sourceGroup);
      break;

    case 'update_calendar_event':
      await processUpdateCalendarEvent(data as any, sourceGroup);
      break;

    case 'delete_calendar_event':
      await processDeleteCalendarEvent(data as any, sourceGroup);
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

async function processSendGmail(
  data: {
    to?: string[];
    subject?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    html?: boolean;
  },
  sourceGroup: string,
): Promise<void> {
  try {
    const { google } = await import('googleapis');
    const { homedir } = await import('os');

    const tokenPath = path.join(homedir(), '.gmail-mcp', 'googleapis-tokens.json');
    const credentialsPath = path.join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

    if (!fs.existsSync(tokenPath) || !fs.existsSync(credentialsPath)) {
      logger.error(
        { sourceGroup },
        'Gmail OAuth not configured. Run: node /workspace/project/scripts/gmail-oauth-setup.js',
      );
      return;
    }

    // Load credentials and tokens
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

    const creds = credentials.installed || credentials.web;
    const { client_id, client_secret, redirect_uris } = creds;
    const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

    // Create OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri,
    );
    oAuth2Client.setCredentials(tokens);

    // Create Gmail client
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Build email
    const to = data.to || [];
    const cc = data.cc || [];
    const bcc = data.bcc || [];
    const subject = data.subject || '';
    const body = data.body || '';
    const isHtml = data.html || false;

    const messageParts = [
      `To: ${to.join(', ')}`,
      cc.length > 0 ? `Cc: ${cc.join(', ')}` : '',
      bcc.length > 0 ? `Bcc: ${bcc.join(', ')}` : '',
      `Subject: ${subject}`,
      `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
      '',
      body,
    ];

    const message = messageParts.filter(Boolean).join('\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send email
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    logger.info(
      { sourceGroup, to: to.join(', '), subject },
      'Gmail email sent successfully',
    );
  } catch (err) {
    logger.error(
      { sourceGroup, err },
      'Failed to send Gmail email',
    );
  }
}

async function processListCalendarEvents(
  data: {
    time_min?: string;
    time_max?: string;
    max_results?: number;
    calendar_id?: string;
    timezone?: string;
  },
  sourceGroup: string,
): Promise<void> {
  try {
    const { google } = await import('googleapis');
    const { homedir } = await import('os');

    const tokenPath = path.join(homedir(), '.gmail-mcp', 'googleapis-tokens.json');
    const credentialsPath = path.join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

    if (!fs.existsSync(tokenPath) || !fs.existsSync(credentialsPath)) {
      logger.error(
        { sourceGroup },
        'Google Calendar OAuth not configured. Run: node /workspace/project/scripts/gmail-oauth-setup.js',
      );
      return;
    }

    // Load credentials and tokens
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

    const creds = credentials.installed || credentials.web;
    const { client_id, client_secret, redirect_uris } = creds;
    const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

    // Create OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri,
    );
    oAuth2Client.setCredentials(tokens);

    // Create Calendar client
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // Set default time range (next 7 days)
    const timeMin = data.time_min || new Date().toISOString();
    const timeMax = data.time_max || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // List events
    const response = await calendar.events.list({
      calendarId: data.calendar_id || 'primary',
      timeMin,
      timeMax,
      maxResults: Math.min(data.max_results || 10, 250),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: data.timezone || TIMEZONE,
    });

    const events = response.data.items || [];
    logger.info(
      { sourceGroup, count: events.length, calendarId: data.calendar_id },
      'Calendar events listed successfully',
    );
  } catch (err) {
    logger.error(
      { sourceGroup, err },
      'Failed to list calendar events',
    );
  }
}

async function processGetCalendarEvent(
  data: {
    event_id?: string;
    calendar_id?: string;
    timezone?: string;
  },
  sourceGroup: string,
): Promise<void> {
  try {
    const { google } = await import('googleapis');
    const { homedir } = await import('os');

    const tokenPath = path.join(homedir(), '.gmail-mcp', 'googleapis-tokens.json');
    const credentialsPath = path.join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

    if (!fs.existsSync(tokenPath) || !fs.existsSync(credentialsPath)) {
      logger.error(
        { sourceGroup },
        'Google Calendar OAuth not configured. Run: node /workspace/project/scripts/gmail-oauth-setup.js',
      );
      return;
    }

    if (!data.event_id) {
      logger.error({ sourceGroup }, 'Missing event_id for get_calendar_event');
      return;
    }

    // Load credentials and tokens
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

    const creds = credentials.installed || credentials.web;
    const { client_id, client_secret, redirect_uris } = creds;
    const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

    // Create OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri,
    );
    oAuth2Client.setCredentials(tokens);

    // Create Calendar client
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // Get event
    const response = await calendar.events.get({
      calendarId: data.calendar_id || 'primary',
      eventId: data.event_id,
      timeZone: data.timezone || TIMEZONE,
    });

    logger.info(
      { sourceGroup, eventId: data.event_id },
      'Calendar event retrieved successfully',
    );
  } catch (err) {
    logger.error(
      { sourceGroup, eventId: data.event_id, err },
      'Failed to get calendar event',
    );
  }
}

async function processCreateCalendarEvent(
  data: {
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
    attendees?: string[];
    calendar_id?: string;
    timezone?: string;
    send_notifications?: boolean;
  },
  sourceGroup: string,
): Promise<void> {
  try {
    const { google } = await import('googleapis');
    const { homedir } = await import('os');

    const tokenPath = path.join(homedir(), '.gmail-mcp', 'googleapis-tokens.json');
    const credentialsPath = path.join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

    if (!fs.existsSync(tokenPath) || !fs.existsSync(credentialsPath)) {
      logger.error(
        { sourceGroup },
        'Google Calendar OAuth not configured. Run: node /workspace/project/scripts/gmail-oauth-setup.js',
      );
      return;
    }

    if (!data.summary || !data.start || !data.end) {
      logger.error(
        { sourceGroup },
        'Missing required fields for create_calendar_event: summary, start, end',
      );
      return;
    }

    // Load credentials and tokens
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

    const creds = credentials.installed || credentials.web;
    const { client_id, client_secret, redirect_uris } = creds;
    const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

    // Create OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri,
    );
    oAuth2Client.setCredentials(tokens);

    // Create Calendar client
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // Determine if this is an all-day event (date format without time)
    const isAllDay = !data.start.includes('T');

    const event: any = {
      summary: data.summary,
      start: isAllDay
        ? { date: data.start, timeZone: data.timezone || TIMEZONE }
        : { dateTime: data.start, timeZone: data.timezone || TIMEZONE },
      end: isAllDay
        ? { date: data.end, timeZone: data.timezone || TIMEZONE }
        : { dateTime: data.end, timeZone: data.timezone || TIMEZONE },
    };

    if (data.description) {
      event.description = data.description;
    }

    if (data.location) {
      event.location = data.location;
    }

    if (data.attendees && data.attendees.length > 0) {
      event.attendees = data.attendees.map((email) => ({ email }));
    }

    // Create event
    const response = await calendar.events.insert({
      calendarId: data.calendar_id || 'primary',
      requestBody: event,
      sendUpdates: data.send_notifications ? 'all' : 'none',
    });

    logger.info(
      { sourceGroup, eventId: response.data.id, summary: data.summary },
      'Calendar event created successfully',
    );
  } catch (err) {
    logger.error(
      { sourceGroup, summary: data.summary, err },
      'Failed to create calendar event',
    );
  }
}

async function processUpdateCalendarEvent(
  data: {
    event_id?: string;
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
    attendees?: string[];
    calendar_id?: string;
    timezone?: string;
    send_notifications?: boolean;
  },
  sourceGroup: string,
): Promise<void> {
  try {
    const { google } = await import('googleapis');
    const { homedir } = await import('os');

    const tokenPath = path.join(homedir(), '.gmail-mcp', 'googleapis-tokens.json');
    const credentialsPath = path.join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

    if (!fs.existsSync(tokenPath) || !fs.existsSync(credentialsPath)) {
      logger.error(
        { sourceGroup },
        'Google Calendar OAuth not configured. Run: node /workspace/project/scripts/gmail-oauth-setup.js',
      );
      return;
    }

    if (!data.event_id) {
      logger.error({ sourceGroup }, 'Missing event_id for update_calendar_event');
      return;
    }

    // Load credentials and tokens
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

    const creds = credentials.installed || credentials.web;
    const { client_id, client_secret, redirect_uris } = creds;
    const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

    // Create OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri,
    );
    oAuth2Client.setCredentials(tokens);

    // Create Calendar client
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // Get existing event first
    const existingEvent = await calendar.events.get({
      calendarId: data.calendar_id || 'primary',
      eventId: data.event_id,
    });

    const event: any = { ...existingEvent.data };

    // Update only provided fields
    if (data.summary !== undefined) {
      event.summary = data.summary;
    }

    if (data.start !== undefined) {
      const isAllDay = !data.start.includes('T');
      event.start = isAllDay
        ? { date: data.start, timeZone: data.timezone || TIMEZONE }
        : { dateTime: data.start, timeZone: data.timezone || TIMEZONE };
    }

    if (data.end !== undefined) {
      const isAllDay = !data.end.includes('T');
      event.end = isAllDay
        ? { date: data.end, timeZone: data.timezone || TIMEZONE }
        : { dateTime: data.end, timeZone: data.timezone || TIMEZONE };
    }

    if (data.description !== undefined) {
      event.description = data.description;
    }

    if (data.location !== undefined) {
      event.location = data.location;
    }

    if (data.attendees !== undefined) {
      event.attendees = data.attendees.map((email) => ({ email }));
    }

    // Update event
    await calendar.events.update({
      calendarId: data.calendar_id || 'primary',
      eventId: data.event_id,
      requestBody: event,
      sendUpdates: data.send_notifications ? 'all' : 'none',
    });

    logger.info(
      { sourceGroup, eventId: data.event_id },
      'Calendar event updated successfully',
    );
  } catch (err) {
    logger.error(
      { sourceGroup, eventId: data.event_id, err },
      'Failed to update calendar event',
    );
  }
}

async function processDeleteCalendarEvent(
  data: {
    event_id?: string;
    calendar_id?: string;
    send_notifications?: boolean;
  },
  sourceGroup: string,
): Promise<void> {
  try {
    const { google } = await import('googleapis');
    const { homedir } = await import('os');

    const tokenPath = path.join(homedir(), '.gmail-mcp', 'googleapis-tokens.json');
    const credentialsPath = path.join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

    if (!fs.existsSync(tokenPath) || !fs.existsSync(credentialsPath)) {
      logger.error(
        { sourceGroup },
        'Google Calendar OAuth not configured. Run: node /workspace/project/scripts/gmail-oauth-setup.js',
      );
      return;
    }

    if (!data.event_id) {
      logger.error({ sourceGroup }, 'Missing event_id for delete_calendar_event');
      return;
    }

    // Load credentials and tokens
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

    const creds = credentials.installed || credentials.web;
    const { client_id, client_secret, redirect_uris } = creds;
    const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';

    // Create OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri,
    );
    oAuth2Client.setCredentials(tokens);

    // Create Calendar client
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // Delete event
    await calendar.events.delete({
      calendarId: data.calendar_id || 'primary',
      eventId: data.event_id,
      sendUpdates: data.send_notifications ? 'all' : 'none',
    });

    logger.info(
      { sourceGroup, eventId: data.event_id },
      'Calendar event deleted successfully',
    );
  } catch (err) {
    logger.error(
      { sourceGroup, eventId: data.event_id, err },
      'Failed to delete calendar event',
    );
  }
}

import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '@/auth/session';
import { __setMailboxClient, listInbox, readMessage } from './service';
import type { ListResult, MailboxClient, MessageDetail } from './mailbox';

const session = { sub: 'usr_1', username: 'u', team: 'sm', role: 'sm_admin' } as unknown as Session;

function fake(overrides: Partial<MailboxClient> = {}): MailboxClient {
  const base: MailboxClient = {
    folders: async () => [{ path: 'INBOX', name: 'INBOX' }],
    list: async (folder, o): Promise<ListResult> => ({
      folder,
      total: 3,
      unread: 1,
      limit: o.limit,
      offset: o.offset,
      items: [{ uid: 3, subject: 'third', from: 'a', date: '2026-10-13T00:00:00.000Z', seen: false, flagged: false, answered: false }],
    }),
    read: async (): Promise<MessageDetail | null> => null,
    setFlag: async () => {},
    move: async () => {},
  };
  return { ...base, ...overrides };
}

afterEach(() => __setMailboxClient(null));

describe('team inbox service', () => {
  it('passes the folder, paging and unread filter to the mailbox', async () => {
    let seen: unknown = null;
    __setMailboxClient(fake({ list: async (folder, o) => { seen = { folder, ...o }; return { folder, total: 0, unread: 0, limit: o.limit, offset: o.offset, items: [] }; } }));
    await listInbox(session, { folder: 'Sent', limit: 500, offset: -4, unreadOnly: true });
    expect(seen).toEqual({ folder: 'Sent', limit: 100, offset: 0, unreadOnly: true });
  });

  it('defaults to INBOX', async () => {
    let folder = '';
    __setMailboxClient(fake({ list: async (f, o) => { folder = f; return { folder: f, total: 0, unread: 0, limit: o.limit, offset: o.offset, items: [] }; } }));
    await listInbox(session, {});
    expect(folder).toBe('INBOX');
  });

  it('opening a message marks it read and returns sanitised HTML', async () => {
    const flags: string[] = [];
    __setMailboxClient(
      fake({
        read: async () => ({
          uid: 9, subject: 's', from: 'a', date: '', seen: false, flagged: false, answered: false,
          to: [], cc: [], messageId: '<m1>', references: [], text: 't',
          html: '<p onclick="x()">hi</p><script>alert(1)</script>', attachments: [],
        }),
        setFlag: async (_f, _u, flag) => { flags.push(flag); },
      }),
    );
    const msg = await readMessage(session, 'INBOX', 9);
    expect(flags).toEqual(['seen']);
    expect(msg?.seen).toBe(true);
    expect(msg?.html_safe).not.toContain('<script');
    expect(msg?.html_safe).not.toContain('onclick');
  });
});

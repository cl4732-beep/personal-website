interface Book {
  name: string;
  author: string;
  status: string;
  dateFinished: string | null;
}

interface BooksByMonth {
  label: string;
  sortKey: string;
  books: Book[];
}

async function findDatabaseId(pageId: string, token: string): Promise<string> {
  const response = await fetch(
    `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    }
  );
  const data = await response.json();
  for (const block of data.results) {
    if (block.type === 'child_database') {
      return block.id;
    }
  }
  throw new Error('No database found in Notion page');
}

export async function getBooks(): Promise<Book[]> {
  const token = import.meta.env.NOTION_TOKEN;
  const pageId = import.meta.env.NOTION_BOOKS_DATABASE_ID;
  const databaseId = await findDatabaseId(pageId, token);

  const results: Book[] = [];
  let cursor: string | undefined = undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const response = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Notion error body:', errorBody);
      throw new Error(`Notion API failed: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();

    for (const page of data.results) {
      const props = page.properties;

      const name =
        props['Book Name']?.title?.[0]?.plain_text ??
        props['Book Name']?.rich_text?.[0]?.plain_text ??
        '';

      const authorProp = props['Author'];
      const author =
        authorProp?.rich_text?.[0]?.plain_text ??
        authorProp?.select?.name ??
        authorProp?.multi_select?.map((s: any) => s.name).join(', ') ??
        authorProp?.title?.[0]?.plain_text ??
        authorProp?.people?.[0]?.name ??
        authorProp?.rollup?.array?.[0]?.title?.[0]?.plain_text ??
        authorProp?.formula?.string ??
        '';

      const status =
        props['Status']?.select?.name ??
        props['Status']?.status?.name ??
        '';

      const dateFinished =
        props['Date Finished']?.date?.start ?? null;

      if (name) {
        results.push({ name, author, status, dateFinished });
      }
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

export function groupBooksByMonth(books: Book[]): BooksByMonth[] {
  const map = new Map<string, Book[]>();

  for (const book of books) {
    if (!book.dateFinished) continue;

    const sortKey = book.dateFinished.slice(0, 7);

    if (!map.has(sortKey)) {
      map.set(sortKey, []);
    }
    map.get(sortKey)!.push(book);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([sortKey, books]) => {
      const date = new Date(sortKey + '-01');
      const label = date.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });
      return { label, sortKey, books };
    });
}

interface BooksByYear {
  year: string;
  read: Book[];
  reading: Book[];
}

export function groupBooksByYear(books: Book[]): BooksByYear[] {
  const currentYear = new Date().getFullYear().toString();
  const map = new Map<string, { read: Book[]; reading: Book[] }>();

  for (const book of books) {
    if (book.status === 'Reading') {
      // Currently reading books go under the current year
      if (!map.has(currentYear)) {
        map.set(currentYear, { read: [], reading: [] });
      }
      map.get(currentYear)!.reading.push(book);
    } else if (book.status === 'Read' && book.dateFinished) {
      const year = book.dateFinished.slice(0, 4);
      if (!map.has(year)) {
        map.set(year, { read: [], reading: [] });
      }
      map.get(year)!.read.push(book);
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, { read, reading }]) => ({ year, read, reading }));
}

export type { Book, BooksByMonth, BooksByYear };

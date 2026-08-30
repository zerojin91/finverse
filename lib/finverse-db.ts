import postgres from "postgres";

type Row = Record<string, unknown>;

let client: postgres.Sql | undefined;

const databaseUrl = () => {
  const value = process.env.FINVERSE_DATABASE_URL?.trim();
  if (!value) throw new Error("FINVERSE_DATABASE_URL이 설정되지 않았습니다.");
  return value;
};

const database = () => {
  if (!client) {
    // postgres accepts PostgreSQL's `options` startup parameter, although its
    // current TypeScript declaration does not expose that field.
    const options = {
      connect_timeout: 8,
      idle_timeout: 20,
      max: 8,
      options: "-c statement_timeout=60000 -c idle_in_transaction_session_timeout=15000 -c max_parallel_workers_per_gather=0",
      prepare: false,
    } as unknown as postgres.Options<Record<string, never>>;
    client = postgres(databaseUrl(), options);
  }
  return client;
};

const literal = (value: unknown) => {
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
};

/** Server-only FINVERSE database query. Never import this from client code. */
export const finverseSql = <T = Row[]>(strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.reduce((result, part, index) => result + part + (index < values.length ? literal(values[index]) : ""), "");
  return database().unsafe(query) as unknown as Promise<T>;
};

export const finverseQuery = <T = Row>(query: string) => database().unsafe(query) as unknown as Promise<T[]>;

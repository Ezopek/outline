// The part of `pg` the database test mutex uses; the package ships no types and
// `@types/pg` is not a dependency.
declare module "pg" {
  export interface ClientConfig {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  }

  export interface QueryResult<R> {
    rows: R[];
  }

  export class Client {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }
}

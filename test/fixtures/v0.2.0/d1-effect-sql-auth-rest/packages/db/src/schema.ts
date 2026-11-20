/** Row shape of the example `note` table (see migrations/0001_init.sql). `createdAt` is epoch milliseconds. */
export interface Note {
  readonly id: string
  readonly orgId: string | null
  readonly title: string
  readonly createdAt: number
}

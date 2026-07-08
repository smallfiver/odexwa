import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `products`, `funnel_steps` and `funnel_executions` tables backing the
 * per-product sale webhooks + WhatsApp message funnel feature.
 *
 * Hand-authored because `synchronize` is disabled for the `data` connection on
 * PostgreSQL (and may be disabled on SQLite via DATABASE_SYNCHRONIZE=false).
 *
 * Notes:
 * - `products.sessionId` is intentionally NOT a foreign key to `sessions`: deleting or
 *   recreating a WhatsApp session must not cascade away products; sends just fail/retry.
 * - `funnel_executions.nextStepAt` / `completedAt` use the same dialect mapping as
 *   dateColumnType(): `timestamp` on Postgres, `text` (ISO string via DateTransformer)
 *   on SQLite.
 * - `stepResults` is simple-json → plain `text` on both dialects.
 */
export class AddProductsFunnel1782200000000 implements MigrationInterface {
  name = 'AddProductsFunnel1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (!(await queryRunner.hasTable('products'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "products" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, "name" varchar(100) NOT NULL, "webhookToken" varchar(64) NOT NULL, "sessionId" varchar NOT NULL, "active" boolean NOT NULL DEFAULT true, "createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW())`,
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "products" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar(100) NOT NULL, "webhookToken" varchar(64) NOT NULL, "sessionId" varchar NOT NULL, "active" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`,
        );
      }
      await queryRunner.query(`CREATE UNIQUE INDEX "IDX_products_webhookToken" ON "products" ("webhookToken")`);
    }

    if (!(await queryRunner.hasTable('funnel_steps'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "funnel_steps" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, "productId" varchar NOT NULL, "order" integer NOT NULL, "delayMinutes" integer NOT NULL DEFAULT 0, "type" varchar(20) NOT NULL, "text" text NOT NULL DEFAULT '', "mediaPath" varchar(1024), "mediaFilename" varchar(255), "mediaMimetype" varchar(127), "createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW(), CONSTRAINT "FK_funnel_steps_productId" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "funnel_steps" ("id" varchar PRIMARY KEY NOT NULL, "productId" varchar NOT NULL, "order" integer NOT NULL, "delayMinutes" integer NOT NULL DEFAULT (0), "type" varchar(20) NOT NULL, "text" text NOT NULL DEFAULT (''), "mediaPath" varchar(1024), "mediaFilename" varchar(255), "mediaMimetype" varchar(127), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_funnel_steps_productId" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      }
      await queryRunner.query(`CREATE INDEX "IDX_funnel_steps_productId" ON "funnel_steps" ("productId")`);
    }

    if (!(await queryRunner.hasTable('funnel_executions'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "funnel_executions" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, "productId" varchar NOT NULL, "customerName" varchar(255) NOT NULL DEFAULT '', "customerPhone" varchar(64) NOT NULL DEFAULT '', "chatId" varchar(64) NOT NULL, "source" varchar(20) NOT NULL, "currentStepIndex" integer NOT NULL DEFAULT 0, "nextStepAt" timestamp, "status" varchar(20) NOT NULL DEFAULT 'running', "stepResults" text NOT NULL DEFAULT '[]', "createdAt" timestamp NOT NULL DEFAULT NOW(), "completedAt" timestamp, CONSTRAINT "FK_funnel_executions_productId" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "funnel_executions" ("id" varchar PRIMARY KEY NOT NULL, "productId" varchar NOT NULL, "customerName" varchar(255) NOT NULL DEFAULT (''), "customerPhone" varchar(64) NOT NULL DEFAULT (''), "chatId" varchar(64) NOT NULL, "source" varchar(20) NOT NULL, "currentStepIndex" integer NOT NULL DEFAULT (0), "nextStepAt" text, "status" varchar(20) NOT NULL DEFAULT ('running'), "stepResults" text NOT NULL DEFAULT ('[]'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "completedAt" text, CONSTRAINT "FK_funnel_executions_productId" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      }
      await queryRunner.query(`CREATE INDEX "IDX_funnel_executions_productId" ON "funnel_executions" ("productId")`);
      await queryRunner.query(`CREATE INDEX "IDX_funnel_executions_nextStepAt" ON "funnel_executions" ("nextStepAt")`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IF EXISTS so revert is idempotent on a synchronize-bootstrapped DB, where up() recorded the
    // migration via the hasTable early-return and the named indexes were never created.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_funnel_executions_nextStepAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_funnel_executions_productId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_executions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_funnel_steps_productId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_steps"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_webhookToken"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
  }
}

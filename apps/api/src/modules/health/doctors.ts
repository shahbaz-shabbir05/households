/**
 * Doctors — a household's address book of who they see.
 *
 * Created on demand by name the first time an appointment or a prescription
 * mentions them, the same way providers work for bills, so the list builds
 * itself rather than being a form someone has to fill in first.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { CreateDoctorInput, UpdateDoctorInput } from '@hms/shared';
import { doctors } from '../../db/schema/index.js';
import type { Database, DbExecutor } from '../../db/client.js';
import { ConflictError, NotFoundError, PG_UNIQUE_VIOLATION, pgErrorCode } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan } from '../../core/policy/index.js';
import type { RequestContext } from '../../core/request-context.js';

export interface DoctorView {
  id: string;
  name: string;
  specialty: string | null;
  clinic: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}

export class DoctorService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ctx: RequestContext): Promise<DoctorView[]> {
    assertCan(ctx, 'health:read');
    const rows = await this.db
      .select()
      .from(doctors)
      .where(and(eq(doctors.householdId, ctx.household.id), isNull(doctors.deletedAt)))
      .orderBy(asc(doctors.name));
    return rows.map(toView);
  }

  async create(ctx: RequestContext, input: CreateDoctorInput): Promise<DoctorView> {
    assertCan(ctx, 'health:create');

    try {
      const created = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(doctors)
          .values({
            householdId: ctx.household.id,
            name: input.name,
            specialty: input.specialty ?? null,
            clinic: input.clinic ?? null,
            phone: input.phone ?? null,
            address: input.address ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          })
          .returning();

        await writeAudit(tx, ctx, {
          entityType: 'household',
          entityId: row!.id,
          action: 'create',
          summary: `Added Dr ${row!.name} to the household's contacts`,
        });
        return row!;
      });
      return toView(created);
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictError(`Dr ${input.name} is already in your list`);
      }
      throw error;
    }
  }

  async update(ctx: RequestContext, doctorId: string, input: UpdateDoctorInput): Promise<DoctorView> {
    assertCan(ctx, 'health:update');
    const existing = await this.find(ctx, doctorId);

    const updated = await this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return existing;

      const [row] = await tx
        .update(doctors)
        .set({ ...input, updatedBy: ctx.user.id, updatedAt: this.now() })
        .where(eq(doctors.id, doctorId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'household',
        entityId: doctorId,
        action: 'update',
        changes,
      });
      return row!;
    });

    return toView(updated);
  }

  async remove(ctx: RequestContext, doctorId: string): Promise<void> {
    assertCan(ctx, 'health:delete');
    const existing = await this.find(ctx, doctorId);

    await this.db.transaction(async (tx) => {
      // Soft: appointments and prescriptions still reference them, and the
      // history of who treated whom should survive tidying up a list.
      await tx
        .update(doctors)
        .set({ deletedAt: this.now(), updatedBy: ctx.user.id })
        .where(eq(doctors.id, doctorId));
      await writeAudit(tx, ctx, {
        entityType: 'household',
        entityId: doctorId,
        action: 'delete',
        summary: `Removed Dr ${existing.name} from the household's contacts`,
      });
    });
  }

  /** Finds by name, or creates on first mention. Shared with appointments. */
  async resolveByName(
    tx: DbExecutor,
    ctx: RequestContext,
    name: string | undefined,
  ): Promise<string | null> {
    if (!name) return null;

    const existing = await tx
      .select({ id: doctors.id })
      .from(doctors)
      .where(
        and(
          eq(doctors.householdId, ctx.household.id),
          sql`lower(${doctors.name}) = ${name.toLowerCase()}`,
          isNull(doctors.deletedAt),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;

    const [created] = await tx
      .insert(doctors)
      .values({ householdId: ctx.household.id, name, createdBy: ctx.user.id })
      .returning({ id: doctors.id });
    return created!.id;
  }

  private async find(ctx: RequestContext, doctorId: string) {
    const row = await this.db.query.doctors.findFirst({
      where: and(
        eq(doctors.id, doctorId),
        eq(doctors.householdId, ctx.household.id),
        isNull(doctors.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Doctor');
    return row;
  }
}

function toView(row: typeof doctors.$inferSelect): DoctorView {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    clinic: row.clinic,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
  };
}

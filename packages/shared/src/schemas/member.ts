import { z } from 'zod';
import { HOUSEHOLD_ROLES, RELATIONSHIPS } from '../enums.js';
import { optionalCivilDate, optionalText, requiredText, uuidSchema } from './common.js';
import { emailSchema } from './auth.js';

export const roleSchema = z.enum(HOUSEHOLD_ROLES);
export const relationshipSchema = z.enum(RELATIONSHIPS);

/**
 * Creating a member never creates a login. A member is a *person in the
 * household*; a user is a *login*. Children and helpers are assignable without
 * an account, which is why these are separate concepts (docs/04).
 */
export const createMemberSchema = z.object({
  displayName: requiredText(80, 'Name'),
  role: roleSchema.default('adult'),
  relationship: relationshipSchema.default('other'),
  dateOfBirth: optionalCivilDate(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  phone: optionalText(40),
  email: emailSchema.optional(),
  emergencyContactName: optionalText(80),
  emergencyContactPhone: optionalText(40),
  notes: optionalText(2000),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = createMemberSchema.partial().extend({
  isActive: z.boolean().optional(),
  avatarAttachmentId: uuidSchema.nullable().optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const listMembersQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
  role: roleSchema.optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

/**
 * Invites bind a login to an *existing* member row, so assignment history
 * survives the transition from "person we track" to "person who logs in".
 */
export const createInviteSchema = z.object({
  memberId: uuidSchema,
  email: emailSchema,
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(16).max(200),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

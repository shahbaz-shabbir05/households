import { z } from 'zod';
import { requiredText } from './common.js';

/**
 * Password policy: length over composition rules. NIST 800-63B guidance, and
 * composition rules ("must contain a symbol") measurably push users toward
 * predictable patterns. A common-password denylist is applied server-side.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters — length matters more than symbols')
  .max(200, 'Passwords longer than 200 characters are not supported');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(255);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: requiredText(80, 'Your name'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(16).max(200) });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const updateProfileSchema = z.object({
  displayName: requiredText(80, 'Your name').optional(),
  locale: z.string().max(20).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

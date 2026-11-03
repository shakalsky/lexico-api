import type { User } from '../db/schema.js';

/** Registered in `app.ts`; routes refer to it as `UserDto#`. */
export const userDtoSchema = {
  $id: 'UserDto',
  type: 'object',
  required: ['id', 'email', 'created_at'],
  properties: {
    id: { type: 'string' },
    email: { type: 'string', description: 'Lowercased.' },
    created_at: { type: 'string', description: 'ISO 8601 in UTC with milliseconds.' },
  },
} as const;

export function toUserDto(user: User) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.createdAt.toISOString(),
  };
}

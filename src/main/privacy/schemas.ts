// Owner: Agent F. Zod schemas for everything privacy stores. Strict: unknown keys are rejected.
import { z } from 'zod'
import type { AppSettings, PrivacySettings, SessionRecord } from '@shared/types'

const cameraMode = z.enum(['checkins', 'continuous'])

export const privacySchema = z.strictObject({
  camera: z.enum(['yes', 'not-now']).nullable(),
  cameraMode,
  face: z.enum(['vitals-and-face', 'vitals-only']).nullable(),
  music: z.enum(['spotify', 'none']),
  aiScoring: z.boolean(),
  telemetry: z.boolean(),
  autoDelete: z.union([z.literal(30), z.literal(90), z.literal('never')]),
  answeredAt: z.number().nullable()
}) satisfies z.ZodType<PrivacySettings>

export const settingsSchema = z.strictObject({
  checkinIntervalMin: z.union([z.literal(3), z.literal(5), z.literal(10)]),
  nudgeMinIntervalMin: z.number().positive(),
  leaveMusicAlone: z.boolean(),
  devVideoSource: z.string().nullable(),
  devFramingPad: z.number().min(0).max(0.6),
  orbPosition: z.strictObject({ x: z.number(), y: z.number() }).nullable(),
  thresholdOverrides: z.record(z.string(), z.number())
}) satisfies z.ZodType<AppSettings>

const situation = z.enum(['focused', 'tense', 'crashing', 'low', 'good'])
const moveId = z.enum(['breathe', 'neck-stretch', 'stand-stretch', 'walk', 'step-outside'])

/** History record: labels and counts only. A record carrying any extra field is rejected. */
export const sessionRecordSchema = z.strictObject({
  id: z.string().min(1),
  activity: z.enum(['deep-work', 'debugging', 'writing', 'admin', 'downtime']),
  startedAt: z.number(),
  endedAt: z.number(),
  lengthMin: z.number().nonnegative(),
  cameraMode: z.union([cameraMode, z.literal('off')]),
  moodTimeline: z.array(
    z.strictObject({ t: z.number(), situation: z.union([situation, z.enum(['away', 'unknown'])]) })
  ),
  moves: z.array(
    z.strictObject({ t: z.number(), moveId, outcome: z.enum(['done', 'snoozed', 'skipped']) })
  ),
  snoozes: z.number().int().nonnegative(),
  longestSeatedMin: z.number().nonnegative(),
  learnedSongIds: z.array(z.string())
}) satisfies z.ZodType<SessionRecord>

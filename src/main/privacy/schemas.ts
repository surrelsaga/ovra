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
  thresholdOverrides: z.record(z.string(), z.number()),
  cameraTeachCount: z.number().int().nonnegative()
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

/** Catalog metadata and local vote counts; no sensing readings belong in these records. */
export const songSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  firstSeenAt: z.number(),
  lastPlayedAt: z.number().optional(),
  playCount: z.number().int().nonnegative(),
  origin: z.enum(['mine', 'fallback', 'heard']).optional(),
  playlists: z.array(z.string()).optional(),
  playable: z.boolean().optional(),
  scores: z
    .strictObject({
      energy: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      mood: z.enum(['dark', 'neutral', 'bright']),
      vocals: z.enum(['instrumental', 'light', 'heavy']),
      confidence: z.number().min(0).max(1),
      source: z.enum(['rules', 'lastfm', 'llm', 'web', 'learned']),
      scoredAt: z.number(),
      tags: z.array(z.string()).optional()
    })
    .optional(),
  learned: z
    .strictObject({
      energyDelta: z.number(),
      confidenceDelta: z.number(),
      settleVotes: z.number().int().nonnegative(),
      steadyVotes: z.number().int().nonnegative(),
      liftVotes: z.number().int().nonnegative().optional(),
      goodVotes: z.number().int().nonnegative().optional(),
      quickSkips: z.number().int().nonnegative(),
      plays: z.number().int().nonnegative(),
      updatedAt: z.number()
    })
    .optional()
})
export const playlistSchema = z.strictObject({
  uri: z.string(),
  url: z.string(),
  addedAt: z.number(),
  name: z.string().optional(),
  trackCount: z.number().int().nonnegative().optional(),
  totalCount: z.number().int().nonnegative().optional(),
  fetchedAt: z.number().optional(),
  readError: z.string().optional()
})

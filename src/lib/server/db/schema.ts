import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', { 
	id: text('id').primaryKey(), 
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	roles: text('roles', { mode: 'json' }).$type<string[]>().default([]).notNull(),
	verificationToken: text('verification_token'),
	resetPasswordToken: text('reset_password_token'),
	resetPasswordExpires: integer('reset_password_expires', { mode: 'timestamp' }),
	emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const userProfile = sqliteTable('user_profile', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }).unique(),
	title: text('title'),
	firstName: text('first_name'),
	lastName: text('last_name'),
	dateOfBirth: integer('date_of_birth', { mode: 'timestamp' }),
	phoneNumber: text('phone_number')
});

export const segment = sqliteTable('segment', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	icon: text('icon').notNull(),
	sortOrder: integer('sort_order').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

export const milestone = sqliteTable('milestone', {
	id: text('id').primaryKey(),
	segmentId: text('segment_id')
		.notNull()
		.references(() => segment.id),
	title: text('title').notNull(),
	description: text('description'),
	date: integer('date', { mode: 'timestamp' }).notNull(),
	avatar: text('avatar'),
	meta: text('meta', { mode: 'json' }).$type<{ type: 'coordinates' | 'link' | 'icon'; value: string; label?: string; icon?: string }[]>().default([]),
	published: integer('published', { mode: 'boolean' }).default(false).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

export const milestoneMedia = sqliteTable('milestone_media', {
	id: text('id').primaryKey(),
	milestoneId: text('milestone_id')
		.notNull()
		.references(() => milestone.id, { onDelete: 'cascade' }),
	type: text('type', { enum: ['image', 'video'] }).notNull(),
	url: text('url').notNull(),
	thumbnailUrl: text('thumbnail_url'), // for videos: the thumbnail to display
	caption: text('caption'),
	duration: integer('duration'), // video duration in seconds
	videoJobId: text('video_job_id').references(() => videoJob.id, { onDelete: 'set null' }), // tracks video processing
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Chunked upload tracking for resumable uploads
export const uploadSession = sqliteTable('upload_session', {
	id: text('id').primaryKey(),
	filename: text('filename').notNull(),
	fileSize: integer('file_size').notNull(),
	mimeType: text('mime_type').notNull(),
	chunkSize: integer('chunk_size').notNull(),
	totalChunks: integer('total_chunks').notNull(),
	uploadedChunks: text('uploaded_chunks', { mode: 'json' }).$type<number[]>().default([]).notNull(),
	status: text('status', { enum: ['pending', 'uploading', 'completed', 'failed'] }).notNull().default('pending'),
	filePath: text('file_path'), // final file path once assembled
	milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'cascade' }),
	checksum: text('checksum'), // file checksum for verification
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull() // auto-cleanup old uploads
});

export const comment = sqliteTable('comment', {
	id: text('id').primaryKey(),
	milestoneId: text('milestone_id')
		.notNull()
		.references(() => milestone.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.references(() => user.id, { onDelete: 'set null' }),
	authorName: text('author_name').notNull(),
	content: text('content').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

export const reaction = sqliteTable('reaction', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	milestoneId: text('milestone_id')
		.references(() => milestone.id, { onDelete: 'cascade' }),
	commentId: text('comment_id')
		.references(() => comment.id, { onDelete: 'cascade' }),
	emoji: text('emoji').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Video processing job queue
export const videoJob = sqliteTable('video_job', {
	id: text('id').primaryKey(),
	inputPath: text('input_path').notNull(),
	mimeType: text('mime_type').notNull(),
	filename: text('filename').notNull(),
	status: text('status', { enum: ['pending', 'processing', 'completed', 'failed', 'dead-letter'] }).notNull().default('pending'),
	progress: integer('progress').default(0),
	retryCount: integer('retry_count').default(0).notNull(),
	resultUrl: text('result_url'),
	thumbnailUrl: text('thumbnail_url'),
	duration: integer('duration'),
	error: text('error'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	startedAt: integer('started_at', { mode: 'timestamp' }),
	completedAt: integer('completed_at', { mode: 'timestamp' })
});

export type Session = typeof session.$inferSelect;
export type User = typeof user.$inferSelect;
export type Segment = typeof segment.$inferSelect;
export type Milestone = typeof milestone.$inferSelect;
export type MilestoneMedia = typeof milestoneMedia.$inferSelect;
export type UploadSession = typeof uploadSession.$inferSelect;
export type Comment = typeof comment.$inferSelect;
export type Reaction = typeof reaction.$inferSelect;
export type VideoJob = typeof videoJob.$inferSelect;

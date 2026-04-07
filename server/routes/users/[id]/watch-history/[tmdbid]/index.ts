import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';

const watchHistoryMetaSchema = z.object({
  title: z.string(),
  year: z.number().optional(),
  poster: z.string().optional(),
  type: z.enum(['movie', 'show']),
});

const watchHistoryItemSchema = z.object({
  meta: watchHistoryMetaSchema,
  tmdbId: z.string(),
  duration: z.number().transform(n => n.toString()),
  watched: z.number().transform(n => n.toString()),
  watchedAt: z.string().datetime({ offset: true }),
  completed: z.boolean().optional().default(false),
  seasonId: z.string().optional(),
  episodeId: z.string().optional(),
  seasonNumber: z.number().optional(),
  episodeNumber: z.number().optional(),
});

// 13th July 2021 - movie-web epoch
const minEpoch = 1626134400000;
const movieHistoryId = '\n';

function defaultAndCoerceDateTime(dateTime: string | undefined) {
  const epoch = dateTime ? new Date(dateTime).getTime() : Date.now();
  const clampedEpoch = Math.max(minEpoch, Math.min(epoch, Date.now()));
  return new Date(clampedEpoch);
}

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const tmdbId = event.context.params?.tmdbid;
  const method = event.method;

  const session = await useAuth().getCurrentSession();
  if (!session) {
    throw createError({
      statusCode: 401,
      message: 'Session not found or expired',
    });
  }

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot access other user information',
    });
  }

  if (method === 'PUT') {
    try {
      const body = await readBody(event);

      // Accept single object (normal playback) or array (e.g. user import)
      const bodySchema = z.union([
        watchHistoryItemSchema,
        z.array(watchHistoryItemSchema).max(5000),
      ]);
      const parsed = bodySchema.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      // Guard against route/body mismatches (e.g. /watch-history/import for single writes)
      if (items.length === 1 && tmdbId && tmdbId !== items[0].tmdbId) {
        throw createError({
          statusCode: 400,
          message: 'tmdbId in URL does not match request body',
        });
      }

      const transactionResults = await prisma.$transaction(async tx => {
        const results = [];

        for (const validatedBody of items) {
          const itemTmdbId = validatedBody.tmdbId;
          const watchedAt = defaultAndCoerceDateTime(validatedBody.watchedAt);
          const now = new Date();

          // Normalize IDs for movies so the unique key stays stable.
          const normSeasonId =
            validatedBody.meta.type === 'movie' ? movieHistoryId : (validatedBody.seasonId ?? null);
          const normEpisodeId =
            validatedBody.meta.type === 'movie'
              ? movieHistoryId
              : (validatedBody.episodeId ?? null);

          const data = {
            duration: parseFloat(validatedBody.duration),
            watched: parseFloat(validatedBody.watched),
            watched_at: watchedAt,
            completed: validatedBody.completed,
            meta: validatedBody.meta,
            updated_at: now,
          };

          const existingItem = await tx.watch_history.findFirst({
            where: {
              tmdb_id: itemTmdbId,
              user_id: userId,
              season_id: normSeasonId,
              episode_id: normEpisodeId,
            },
          });

          if (existingItem) {
            results.push(
              await tx.watch_history.update({
                where: { id: existingItem.id },
                data,
              })
            );
            continue;
          }

          results.push(
            await tx.watch_history.create({
              data: {
                id: uuidv7(),
                tmdb_id: itemTmdbId,
                user_id: userId,
                season_id: normSeasonId,
                episode_id: normEpisodeId,
                season_number: validatedBody.seasonNumber ?? null,
                episode_number: validatedBody.episodeNumber ?? null,
                ...data,
              },
            })
          );
        }

        return results;
      });

      if (transactionResults.length === 0) return { success: true, count: 0, items: [] };

      const results = transactionResults.map(watchHistoryItem => ({
        success: true,
        id: watchHistoryItem.id,
        tmdbId: watchHistoryItem.tmdb_id,
        userId: watchHistoryItem.user_id,
        seasonId: watchHistoryItem.season_id === '\n' ? null : watchHistoryItem.season_id,
        episodeId: watchHistoryItem.episode_id === '\n' ? null : watchHistoryItem.episode_id,
        seasonNumber: watchHistoryItem.season_number,
        episodeNumber: watchHistoryItem.episode_number,
        meta: watchHistoryItem.meta,
        duration: watchHistoryItem.duration,
        watched: watchHistoryItem.watched,
        watchedAt: watchHistoryItem.watched_at.toISOString(),
        completed: watchHistoryItem.completed,
        updatedAt: watchHistoryItem.updated_at.toISOString(),
      }));

      return results.length === 1
        ? results[0]
        : { success: true, count: results.length, items: results };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw createError({
          statusCode: 400,
          message: 'Invalid watch history data',
          cause: error.errors,
        });
      }

      console.error('Database error:', error);
      throw createError({
        statusCode: 500,
        message: 'Failed to save watch history',
      });
    }
  }

  if (method === 'DELETE') {
    const body = await readBody(event).catch(() => ({}));

    const whereClause: any = {
      user_id: userId,
      tmdb_id: tmdbId,
    };

    if (body.seasonId) whereClause.season_id = body.seasonId;
    if (body.episodeId) whereClause.episode_id = body.episodeId;

    // Use deleteMany return count directly — no redundant findMany
    const { count } = await prisma.watch_history.deleteMany({
      where: whereClause,
    });

    return {
      success: true,
      count,
      tmdbId,
      episodeId: body.episodeId,
      seasonId: body.seasonId,
    };
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});

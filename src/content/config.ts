import { z, defineCollection } from 'astro:content';

const postsCollection = defineCollection({
    type: 'content',
    schema: z.object({
        title: z.string(),
        date: z.date(),
        mood: z.string().optional(),
        weather: z.string().optional(),
        tags: z.array(z.string()).default([]),
        description: z.string().optional(),
        keywords: z.array(z.string()).default([]),
        draft: z.boolean().default(false),
        // Multi-agent metadata
        agents: z.object({
            ceo: z.string().optional(),
            seo: z.string().optional(),
            writer: z.string().optional(),
            editor: z.string().optional(),
        }).optional(),
    }),
});

export const collections = {
    'posts': postsCollection,
};

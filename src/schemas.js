import { z } from "zod";

export const LeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  website_url: z.string().url(),
  address: z.string().min(1),
});
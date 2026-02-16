import { z } from "zod";

export const LeadPackSchema = z.object({
  // ✅ OBAVEZNO: jer ti buildLeadPack ubacuje lead_info u output
  lead_info: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    email: z.string().min(1),
  }),

  PODACI: z.object({
    Ime: z.string().min(1),
    Email: z.string().min(1),
    Sajt: z.string().min(1),
    Adresa: z.string().nullable(), // može null, ali ključ mora postojati
  }),

  "EMAIL (DE)": z
    .string()
    .min(1)
    .refine((s) => !/(\n- |\n• )/.test(s), { message: "No bullets in email" }),

  "ZA OPERATERA (DE)": z.string().min(300).max(700),
  "ZA OPERATERA (SR)": z.string().min(300).max(700),

  "EMAIL (SR)": z
    .string()
    .min(1)
    .refine((s) => !/(\n- |\n• )/.test(s), { message: "No bullets in email" }),

  "TEHNIČKE NAJVAŽNIJE STVARI": z.array(z.string().min(1)).min(4).max(6),

  // Ako nekad zna da bude prazno, možeš ovo da prebaciš na .nullable()
  "DESCRIPTION_OVERALL": z.string().min(40),

  "UPSELL_MENU": z
    .array(
      z.object({
        service: z.string().min(1),
        why_now: z.string().min(1),
        trigger: z.string().min(1),
        proof_from_data: z.string().min(1),
        next_step: z.string().min(1),
      })
    )
    .min(6)
    .max(12),

  "FOLLOWUP_SEQUENCE": z
    .array(
      z.object({
        step: z.number().int().min(1).max(6),
        when: z.string().min(1),
        channel: z.enum(["email", "call", "whatsapp", "linkedin"]),
        goal: z.string().min(1),
        message_hint: z.string().min(1),
      })
    )
    .min(3)
    .max(6),
});

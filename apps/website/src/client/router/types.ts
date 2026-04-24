import z from "zod";

export const result = z.object({
  result: z.enum(["success", "error"]),
});

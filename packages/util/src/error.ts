import z from "zod"

export abstract class NamedError extends Error {
  abstract schema(): z.core.$ZodType
  abstract toObject(): { name: string; data: unknown }

  static create<Name extends string, Data extends z.core.$ZodType>(name: Name, data: Data) {
    const schema = z
      .object({
        name: z.literal(name),
        data,
      })
      .meta({
        ref: name,
      })
    const result = class extends NamedError {
      public static readonly Schema = schema

      public override readonly name = name as Name

      constructor(
        public readonly data: z.input<Data>,
        options?: ErrorOptions,
      ) {
        const msg =
          typeof (data as Record<string, unknown>)?.message === "string"
            ? ((data as Record<string, unknown>).message as string)
            : name
        super(msg, options)
        this.name = name
      }

      static isInstance(input: unknown): input is InstanceType<typeof result> {
        return (
          typeof input === "object" &&
          input !== null &&
          "name" in input &&
          (input as Record<string, unknown>).name === name
        )
      }

      schema() {
        return schema
      }

      toObject() {
        return {
          name: name,
          data: this.data,
        }
      }
    }
    Object.defineProperty(result, "name", { value: name })
    return result
  }

  public static readonly Unknown = NamedError.create(
    "UnknownError",
    z.object({
      message: z.string(),
    }),
  )
}

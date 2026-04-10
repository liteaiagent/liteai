import { NamedError } from "@liteai/util/error"
import { z } from "zod"

const ErrorDataSchema = z.object({ message: z.string() })

export class SystemPromptLoadError extends NamedError.create("SystemPromptLoadError", ErrorDataSchema) {}

export class MissingSectionMarkerError extends NamedError.create("MissingSectionMarkerError", ErrorDataSchema) {}

export class SectionOrderError extends NamedError.create("SectionOrderError", ErrorDataSchema) {}

export class InvalidSectionAttributeError extends NamedError.create("InvalidSectionAttributeError", ErrorDataSchema) {}

export class DuplicateSectionError extends NamedError.create("DuplicateSectionError", ErrorDataSchema) {}

export class InvalidVolatileReasonError extends NamedError.create("InvalidVolatileReasonError", ErrorDataSchema) {}

export class UnknownSectionError extends NamedError.create("UnknownSectionError", ErrorDataSchema) {}

export class SectionRegistry {
  // Stub
}

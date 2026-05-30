export class VerificationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "VerificationError";
  }
}

export class DriftError extends VerificationError {
  constructor(message: string) {
    super(message, "drift");
    this.name = "DriftError";
  }
}

export class DriftMetadataError extends VerificationError {
  constructor(message: string) {
    super(message, "metadata_corrupt");
    this.name = "DriftMetadataError";
  }
}

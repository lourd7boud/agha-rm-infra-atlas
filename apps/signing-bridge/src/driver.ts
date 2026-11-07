export interface SigningCertificateInfo {
  thumbprint: string;
  subject: string;
  issuer?: string;
  notBefore?: Date;
  notAfter?: Date;
}

export interface DriverInspection {
  available: boolean;
  certificates: SigningCertificateInfo[];
  message?: string;
}

export interface LocalSigningInput {
  taskId: string;
  manifestSha256: string;
  fileId: string;
  filename: string;
  mime: string;
  body: Buffer;
}

export interface LocalSigningOutput {
  body: Buffer;
  filename: string;
  mime: string;
  certificateThumbprint: string;
  certificateSubject: string;
  signedAt: Date;
}

/**
 * Vendor boundary. Implementations talk to Windows CAPI/PKCS#11 or the portal's
 * official signing component locally. A PIN is deliberately absent from every
 * method; token middleware must prompt the human in its own protected UI.
 */
export interface LocalSigningDriver {
  readonly id: string;
  inspect(): Promise<DriverInspection>;
  sign(input: LocalSigningInput): Promise<LocalSigningOutput>;
}

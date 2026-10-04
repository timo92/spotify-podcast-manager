import { Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';

export interface CertificateStackProps extends StackProps {
  domainName: string;
  hostedZoneName: string;
}

/** CloudFront only accepts certificates from us-east-1, hence a separate stack. */
export class CertificateStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);
    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.hostedZoneName });
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}

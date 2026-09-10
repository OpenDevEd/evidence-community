import type { SVGProps } from "react";
import { siZenodo } from "simple-icons";
import BrandIcon from "./BrandIcon";

export function ZenodoIcon(props: SVGProps<SVGSVGElement>) {
 return <BrandIcon icon={siZenodo} viewBox="0 8 24 8" {...props} />;
}

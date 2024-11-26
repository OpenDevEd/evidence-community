import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      d="M9.945 9c0-1.7 1.3-3 3-3s3 1.3 3 3-1.3 3-3 3-3-1.3-3-3Zm3 5c-4.6 0-6 3.3-6 3.3V19h12v-1.7s-1.4-3.3-6-3.3ZM19.445 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM19.445 13c-1.2 0-2.1.3-2.8.8 2.3 1.1 3.2 3 3.2 3.2v.1h4.1v-1.3c0-.1-1.1-2.8-4.5-2.8ZM6.445 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.445 13c1.2 0 2.1.3 2.8.8-2.3 1.1-3.2 3-3.2 3.2v.1h-4.1v-1.3c0-.1 1.1-2.8 4.5-2.8Z"
    />
  </svg>
)
export default SvgComponent

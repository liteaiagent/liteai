/** @jsxImportSource react */

import { Text } from "@liteai/ink"
import React, { Children, isValidElement } from "react"

type Props = {
  children: React.ReactNode
}

export function Byline({ children }: Props): React.ReactNode {
  const validChildren = Children.toArray(children)

  if (validChildren.length === 0) {
    return null
  }

  return (
    <>
      {validChildren.map((child, index) => (
        <React.Fragment key={isValidElement(child) ? (child.key ?? index) : index}>
          {index > 0 && <Text dim> · </Text>}
          {child}
        </React.Fragment>
      ))}
    </>
  )
}

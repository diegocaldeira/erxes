import { colors, dimensions } from "../styles";

import { ITag } from "@erxes/ui-tags/src/types";
import Label from "./Label";
import React from "react";
import styled from "styled-components";
import styledTS from "styled-components-ts";

const TagList = styledTS<{ length: number }>(styled.div).attrs({
  className: (props) => (props.length > 0 ? "tags" : ""),
})`
  > span {
    margin-right: ${dimensions.unitSpacing / 2}px;

    &:last-child {
      margin: 0;
    }
  }
`;

type Props = {
  tags: ITag[];
  size?: string;
  limit?: number;
};

function Tags({ tags, limit }: Props) {
  const length = tags.length;

  return (
    <TagList length={length}>
      {tags.slice(0, limit ? limit : length).map((tag) => {
        return (
          <Label
            key={Math.random()}
            lblColor={tag.colorCode}
            ignoreTrans={true}
          >
            <span>{tag.name}</span>
          </Label>
        );
      })}
      {limit && length - limit > 0 && (
        <Label lblColor={colors.colorCoreGray} ignoreTrans={true}>
          <span>{`+${length - limit}`}</span>
        </Label>
      )}
    </TagList>
  );
}

export default Tags;

import {
  ControlLabel,
  FormControl,
  FormGroup,
} from "@erxes/ui/src/components/form";

import { Attributes } from "../styles";
import Button from "@erxes/ui/src/components/Button";
import { FieldsCombinedByType } from "@erxes/ui-forms/src/settings/properties/types";
import Icon from "@erxes/ui/src/components/Icon";
import PlaceHolderInput from "./PlaceHolderInput";
import Popover from "@erxes/ui/src/components/Popover";
import React from "react";
import { __ } from "@erxes/ui/src/utils";

type Props = {
  triggerType: string;
  triggerConfig?: any;
  config: any;
  label: string;
  attributions: Array<
    { excludeAttr?: boolean; callback?: () => void } & FieldsCombinedByType
  >;
  onSelect: (config: any) => void;
  withDefaultValue?: boolean;
};

type State = {
  searchValue: string;
  fields: Array<
    { excludeAttr?: boolean; callback?: () => void } & FieldsCombinedByType
  >;
};

class SelectFields extends React.Component<Props, State> {
  private overlay: any;

  constructor(props) {
    super(props);

    this.state = {
      fields: [],
      searchValue: "",
    };
  }

  componentDidMount() {
    const { config = {}, attributions = [] } = this.props;

    const selectedFields = attributions.filter((attribution) =>
      Object.keys(config).includes(attribution.name)
    );

    if (selectedFields.length) {
      this.setState({ fields: selectedFields });
    }
  }

  hideContent = () => {
    this.overlay.hide();
  };

  renderFields() {
    const { triggerType, triggerConfig, config, onSelect } = this.props;
    const { fields } = this.state;

    const removeField = ({ _id, name }) => {
      this.setState({ fields: fields.filter((field) => field._id !== _id) });

      onSelect({ ...config, [name]: undefined });
    };

    return fields.map((field) => (
      <PlaceHolderInput
        key={field._id}
        inputName={field.name}
        label={field.label}
        config={config}
        excludeAttr={field.excludeAttr}
        onChange={onSelect}
        triggerType={triggerType}
        fieldType={field.type === "Date" ? "date" : field.type}
        options={field.selectOptions || []}
        optionsAllowedTypes={["contact"]}
        triggerConfig={triggerConfig}
        attrWithSegmentConfig={!!triggerConfig}
        isMulti={true}
        additionalContent={
          <Button
            btnStyle="danger"
            size="small"
            onClick={removeField.bind(this, field)}
          >
            <Icon icon="cancel-1" />
          </Button>
        }
      />
    ));
  }

  render() {
    let { attributions, onSelect, config, withDefaultValue, label } =
      this.props;
    const { fields, searchValue } = this.state;

    const onClickField = (item) => {
      item?.callback && item?.callback();

      this.setState({ fields: [...fields, item] });

      withDefaultValue &&
        onSelect({ ...config, [item.name]: `{{ ${item.name} }}` });

      this.hideContent();
    };

    const onSearch = (e) => {
      const { value } = e.currentTarget as HTMLInputElement;

      this.setState({ searchValue: value });
    };

    if (searchValue) {
      attributions = attributions.filter((option) =>
        new RegExp(searchValue, "i").test(option.label)
      );
    }
    return (
      <>
        {this.renderFields()}
        <Popover
          innerRef={this.overlay}
          trigger={
            <Button btnStyle="simple" block icon="add">
              {__(label || "")}
            </Button>
          }
          placement="top"
        >
          <Attributes>
            <React.Fragment>
              <FormGroup>
                <ControlLabel>{__("Search")}</ControlLabel>
                <FormControl placeholder="type a search" onChange={onSearch} />
              </FormGroup>
              <li>
                <b>{__("Fields")}</b>
              </li>
              {attributions
                .filter(
                  (attribution) =>
                    !fields.find((field) => field._id === attribution._id)
                )
                .map((item) => (
                  <li key={item.name} onClick={onClickField.bind(this, item)}>
                    {__(item.label)}
                  </li>
                ))}
            </React.Fragment>
          </Attributes>
        </Popover>
      </>
    );
  }
}

export default SelectFields;

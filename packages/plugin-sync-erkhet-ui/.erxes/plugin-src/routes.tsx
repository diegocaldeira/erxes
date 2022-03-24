import Settings from './containers/Settings';
import GeneralSettings from './components/GeneralSettings'
import StageSettings from './components/StageSettings'
import PipelineSettings from './components/PipelineSettings'
import React from 'react';
import { Route } from 'react-router-dom';

const GeneralSetting = () => {
  return (
    <Settings
      component={GeneralSettings}
    />
  )
}

const StageSetting = () => {
  return (
    <Settings
      component={StageSettings}
    />
  )
}

const PipelineSetting = () => {
  return (
    <Settings
      component={PipelineSettings}
    />
  )
}

const routes = () => {
  return (
    <React.Fragment>
      <Route
        key="/erxes-plugin-sync-erkhet/settings/general"
        exact={true}
        path="/erxes-plugin-sync-erkhet/settings/general"
        component={GeneralSetting}
      />

      <Route
        key="/erxes-plugin-sync-erkhet/settings/stage"
        exact={true}
        path="/erxes-plugin-sync-erkhet/settings/stage"
        component={StageSetting}
      />

      <Route
        key="/erxes-plugin-sync-erkhet/settings/pipeline"
        exact={true}
        path="/erxes-plugin-sync-erkhet/settings/pipeline"
        component={PipelineSetting}
      />
    </React.Fragment>
  )
};

export default routes;
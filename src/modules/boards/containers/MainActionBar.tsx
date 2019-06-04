import gql from 'graphql-tag';
import { getDefaultBoardAndPipelines } from 'modules/boards/utils';
import { Spinner } from 'modules/common/components';
import { IRouterProps } from 'modules/common/types';
import { router as routerUtils, withProps } from 'modules/common/utils';
import { DealMainActionBar } from 'modules/deals/components';
import { PageHeader } from 'modules/deals/styles/header';
import { ProductsQueryResponse } from 'modules/deals/types';
import { queries as productQueries } from 'modules/settings/productService/graphql';
import queryString from 'query-string';
import * as React from 'react';
import { compose, graphql } from 'react-apollo';
import { withRouter } from 'react-router';
import { MainActionBar as FundamentalMainActionBar } from '../components';
import { STORAGE_BOARD_KEY, STORAGE_PIPELINE_KEY } from '../constants';
import { queries } from '../graphql';
import {
  BoardDetailQueryResponse,
  BoardsGetLastQueryResponse,
  BoardsQueryResponse
} from '../types';

type Props = {
  type: string;
  middleContent?: () => React.ReactNode;
} & IRouterProps;

type FinalProps = {
  boardsQuery: BoardsQueryResponse;
  boardGetLastQuery?: BoardsGetLastQueryResponse;
  boardDetailQuery?: BoardDetailQueryResponse;
  productsQuery?: ProductsQueryResponse;
} & Props;

const getBoardId = ({ location }) => {
  const queryParams = generateQueryParams({ location });
  return queryParams.id;
};

const dateFilterParams = [
  'nextDay',
  'nextWeek',
  'nextMonth',
  'overdue',
  'noCloseDate'
];

const commonParams = [
  'companyIds',
  'customerIds',
  'assignedUserIds',
  'productIds',
  ...dateFilterParams
];

/*
 * Main board component
 */
class Main extends React.Component<FinalProps> {
  private componentSelector;

  constructor(props) {
    super(props);

    this.componentSelector = {
      deal: DealMainActionBar,
      ticket: FundamentalMainActionBar
    };
  }

  onSearch = (search: string) => {
    routerUtils.setParams(this.props.history, { search });
  };

  onDateFilterSelect = (name: string, value: string) => {
    const { history } = this.props;
    const query = { [name]: value };
    const params = generateQueryParams(history);

    // Remove current selected date filter
    for (const param in params) {
      if (dateFilterParams.includes(param)) {
        delete params[param];

        return routerUtils.replaceParam(history, params, query);
      }
    }

    routerUtils.setParams(history, query, true);
  };

  onSelect = (values: string[] | string, name: string) => {
    routerUtils.setParams(this.props.history, { [name]: values });
  };

  onClear = (name: string) => {
    routerUtils.removeParams(this.props.history, name);
  };

  isFiltered = (): boolean => {
    const params = generateQueryParams(this.props.history);

    for (const param in params) {
      if (commonParams.includes(param)) {
        return true;
      }
    }

    return false;
  };

  clearFilter = () => {
    routerUtils.removeParams(this.props.history, ...commonParams);
  };

  render() {
    const {
      history,
      location,
      boardsQuery,
      boardGetLastQuery,
      boardDetailQuery,
      type,
      productsQuery,
      middleContent
    } = this.props;

    if (boardsQuery.loading) {
      return <PageHeader />;
    }

    const queryParams = generateQueryParams({ location });
    const boardId = getBoardId({ location });
    const { pipelineId } = queryParams;

    const { defaultBoards, defaultPipelines } = getDefaultBoardAndPipelines();
    const products = productsQuery ? productsQuery.products : [];

    if (boardId && pipelineId) {
      defaultBoards[type] = boardId;
      defaultPipelines[type] = pipelineId;

      localStorage.setItem(STORAGE_BOARD_KEY, JSON.stringify(defaultBoards));
      localStorage.setItem(
        STORAGE_PIPELINE_KEY,
        JSON.stringify(defaultPipelines)
      );
    }

    // wait for load
    if (boardDetailQuery && boardDetailQuery.loading) {
      return <Spinner />;
    }

    if (boardGetLastQuery && boardGetLastQuery.loading) {
      return <Spinner />;
    }

    const lastBoard = boardGetLastQuery && boardGetLastQuery.boardGetLast;
    const currentBoard = boardDetailQuery && boardDetailQuery.boardDetail;

    // if there is no boardId in queryparams and there is one in localstorage
    // then put those in queryparams
    const [defaultBoardId, defaultPipelineId] = [
      defaultBoards[type],
      defaultPipelines[type]
    ];

    if (!boardId && defaultBoardId) {
      routerUtils.setParams(history, {
        id: defaultBoardId,
        pipelineId: defaultPipelineId
      });

      return null;
    }

    // if there is no boardId in queryparams and there is lastBoard
    // then put lastBoard._id and this board's first pipelineId to queryparams
    if (
      !boardId &&
      lastBoard &&
      lastBoard.pipelines &&
      lastBoard.pipelines.length > 0
    ) {
      const [firstPipeline] = lastBoard.pipelines;

      routerUtils.setParams(history, {
        id: lastBoard._id,
        pipelineId: firstPipeline._id
      });

      return null;
    }

    // If there is an invalid boardId localstorage then remove invalid keys
    // and reload the page
    if (!currentBoard && boardId) {
      delete defaultBoards[type];
      delete defaultPipelines[type];

      localStorage.setItem(STORAGE_BOARD_KEY, JSON.stringify(defaultBoards));
      localStorage.setItem(
        STORAGE_PIPELINE_KEY,
        JSON.stringify(defaultPipelines)
      );
      window.location.href = `/${type}/board`;
      return null;
    }

    if (!currentBoard) {
      return null;
    }

    const pipelines = currentBoard.pipelines || [];
    const currentPipeline = pipelineId
      ? pipelines.find(pipe => pipe._id === pipelineId)
      : pipelines[0];

    const props = {
      middleContent,
      onSearch: this.onSearch,
      queryParams,
      history,
      currentBoard,
      currentPipeline,
      boards: boardsQuery.boards || []
    };

    const extendedProps = {
      ...props,
      type,
      products,
      onSearch: this.onSearch,
      onDateFilterSelect: this.onDateFilterSelect,
      onClear: this.onClear,
      onSelect: this.onSelect,
      isFiltered: this.isFiltered,
      clearFilter: this.clearFilter
    };

    const Component = this.componentSelector[type];

    return <Component {...extendedProps} />;
  }
}

const generateQueryParams = ({ location }) => {
  return queryString.parse(location.search);
};

const MainActionBar = withProps<Props>(
  compose(
    graphql<Props, BoardsQueryResponse>(gql(queries.boards), {
      name: 'boardsQuery',
      options: ({ type }) => ({
        variables: { type }
      })
    }),
    graphql<Props, BoardsGetLastQueryResponse>(gql(queries.boardGetLast), {
      name: 'boardGetLastQuery',
      skip: getBoardId,
      options: ({ type }) => ({
        variables: { type }
      })
    }),
    graphql<{}, ProductsQueryResponse>(gql(productQueries.products), {
      name: 'productsQuery'
    }),
    graphql<Props, BoardDetailQueryResponse, { _id: string }>(
      gql(queries.boardDetail),
      {
        name: 'boardDetailQuery',
        skip: props => !getBoardId(props),
        options: props => ({
          variables: { _id: getBoardId(props) }
        })
      }
    )
  )(Main)
);

export default withRouter(MainActionBar);
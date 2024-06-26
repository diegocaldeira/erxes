import { IMeeting, MeetingsQueryResponse } from "../../types";
import React, { useState } from "react";
import { TabTitle, Tabs } from "@erxes/ui/src/components/tabs";

import { CalendarContainer } from "../../containers/myCalendar/meeting/Calendar";
import Detail from "../../containers/myCalendar/meeting/Detail";
import { IUser } from "@erxes/ui/src/auth/types";
import PreviousDetail from "../../containers/myCalendar/meeting/PreviousDetail";

type Props = {
  meetings?: IMeeting[];
  queryParams: any;
  meetingQuery?: MeetingsQueryResponse;
  currentUser: IUser;
};

export const MyCalendarList = (props: Props) => {
  const { meetings, queryParams } = props;
  const { meetingId } = queryParams;
  const [currentTab, setCurrentTab] = useState("This session");

  const companyId =
    (meetings?.find((meeting) => meeting._id === meetingId)
      ?.companyId as string) || "";

  const renderTabContent = () => {
    if (currentTab === "Previous session") {
      return <PreviousDetail companyId={companyId} queryParams={queryParams} />;
    }
    return <Detail meetingId={meetingId} queryParams={queryParams} />;
  };

  return !meetingId ? (
    <CalendarContainer
      queryParams={queryParams}
      currentUser={props.currentUser}
      meetings={meetings}
    />
  ) : (
    <>
      <Tabs full={true}>
        <TabTitle
          className={currentTab === "This session" ? "active" : ""}
          onClick={() => setCurrentTab("This session")}
        >
          {"This session"}
        </TabTitle>
        <TabTitle
          className={currentTab === "Previous session" ? "active" : ""}
          onClick={() => setCurrentTab("Previous session")}
        >
          {"Previous session"}
        </TabTitle>
      </Tabs>
      {renderTabContent()}
    </>
  );
};

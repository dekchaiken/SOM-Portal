/**
 * Feature-specific analytics tracking
 * 
 * This file contains manual tracking for specific features
 * that need more detailed analytics than automatic page view tracking
 */

// Track when user uses a Jira template
window.trackJiraTemplateUse = function(templateName) {
  if (window.analytics) {
    window.analytics.trackFeature('jira_template_use', {
      template: templateName
    });
  }
};

// Track when user creates a board post
window.trackBoardPostCreate = function(boardType) {
  if (window.analytics) {
    window.analytics.trackFeature('board_post_create', {
      board_type: boardType
    });
  }
};

// Track when user views monitoring dashboard
window.trackMonitoringView = function(dashboardType) {
  if (window.analytics) {
    window.analytics.trackFeature('monitoring_view', {
      dashboard: dashboardType
    });
  }
};

// Track when user checks batch monitor
window.trackBatchMonitorCheck = function(batchType) {
  if (window.analytics) {
    window.analytics.trackFeature('batch_monitor_check', {
      batch_type: batchType
    });
  }
};

// Track when user runs a test service
window.trackTestServiceRun = function(serviceType) {
  if (window.analytics) {
    window.analytics.trackFeature('test_service_run', {
      service: serviceType
    });
  }
};

// Track when user views schedule
window.trackScheduleView = function(viewType) {
  if (window.analytics) {
    window.analytics.trackFeature('schedule_view', {
      view_type: viewType
    });
  }
};

// Track when user updates schedule
window.trackScheduleUpdate = function(updateType) {
  if (window.analytics) {
    window.analytics.trackFeature('schedule_update', {
      update_type: updateType
    });
  }
};

// Track when user views office status
window.trackOfficeStatusView = function() {
  if (window.analytics) {
    window.analytics.trackFeature('office_status_view');
  }
};

// Track when user searches
window.trackSearch = function(searchType, query) {
  if (window.analytics) {
    window.analytics.trackFeature('search', {
      search_type: searchType,
      query_length: query ? query.length : 0
    });
  }
};

// Track when user exports data
window.trackDataExport = function(exportType) {
  if (window.analytics) {
    window.analytics.trackFeature('data_export', {
      export_type: exportType
    });
  }
};

// Track when user views knowledge base
window.trackKnowledgeBaseView = function(articleId) {
  if (window.analytics) {
    window.analytics.trackFeature('knowledge_base_view', {
      article_id: articleId
    });
  }
};

// Track when user creates leave request
window.trackLeaveRequest = function(leaveType) {
  if (window.analytics) {
    window.analytics.trackFeature('leave_request', {
      leave_type: leaveType
    });
  }
};

// Track when user views reports
window.trackReportView = function(reportType) {
  if (window.analytics) {
    window.analytics.trackFeature('report_view', {
      report_type: reportType
    });
  }
};

// Track when user uses MA (Maintenance) feature
window.trackMaintenanceAction = function(action) {
  if (window.analytics) {
    window.analytics.trackFeature('maintenance_action', {
      action: action
    });
  }
};

// Track when user views Sabai dashboard
window.trackSabaiView = function() {
  if (window.analytics) {
    window.analytics.trackFeature('sabai_view');
  }
};

// Track when user views ops runbook
window.trackOpsRunbookView = function(section) {
  if (window.analytics) {
    window.analytics.trackFeature('ops_runbook_view', {
      section: section
    });
  }
};

// Track when user reads/opens an email in inbox
window.trackInboxRead = function() {
  if (window.analytics) {
    window.analytics.trackFeature('inbox_read');
  }
};

// Track when user sends an email from inbox
window.trackInboxSend = function(mode) {
  if (window.analytics) {
    window.analytics.trackFeature('inbox_send', { mode: mode || 'new' });
  }
};

// Track when user views learning main page
window.trackLearningView = function(section) {
  if (window.analytics) {
    window.analytics.trackFeature('learning_view', { section: section || 'main' });
  }
};

// Track when user views a specific course
window.trackCourseView = function(courseId) {
  if (window.analytics) {
    window.analytics.trackFeature('course_view', { course_id: courseId });
  }
};

// Track when user views a specific learning phase
window.trackPhaseView = function(phaseId) {
  if (window.analytics) {
    window.analytics.trackFeature('phase_view', { phase_id: phaseId });
  }
};

// Track when user adds a comment to a board post
window.trackBoardComment = function() {
  if (window.analytics) {
    window.analytics.trackFeature('board_comment');
  }
};

// Track when user creates a Jira ticket from a template
window.trackTicketCreate = function(templateName) {
  if (window.analytics) {
    window.analytics.trackFeature('ticket_create', { template: templateName });
  }
};

console.log('[Analytics Features] Loaded');

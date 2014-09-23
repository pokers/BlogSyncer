bs.controller('mainCtrl', function ($q, $scope, $http, User) {
    $scope.user = User.getUser();

    $scope.username = '당신';
    $scope.message = '의 블로그 글들을 동기화 시킵니다.';
    $scope.signstat = 'Sign in';

    // add DropDown Blog
    $scope.options = [
                    {"Route":"/#/blog/blogRegister","Display":"블로그 등록"},
                    {"Route":"/#/blog/blogSetSync","Display":"동기화 설정"},
                    {"Route":"/#/blog/blogHistorySync","Display":"동기 히스토리"},
                    {"Route":"/#/blog/blogCollectFeedback","Display":"피드백 모음"}
                    ];

    console.log('Start mainCtrl');

    if (!$scope.user.id) {
        var httpGet = function() {
            var deferred = $q.defer();
            $http.get('/user')
                .success(function (data) {
                    if (data == 'NAU') {
                        console.log('NAU');
                    }
                    else {
                        var user = data;
                        User.setUser(user);
                        $scope.signstat = 'My account';
                        $scope.username = user.providers[0].displayName;
                        console.log('Change username, signstat');
                    }
                    deferred.resolve();
                })
                .error(function (data) {
                    window.alert('Error: ' + data);
                });

            return deferred.promise;
        };

        var firsttime_skip = 0;
        httpGet()
            .then(function () {
                console.log('user id = '+ User.getUser().id);
                if (User.getUser().id) {
                    console.log('get_child_port');
                    if (firsttime_skip) {
                        $http.get('/user/child_port')
                            .success(function (data) {
                                console.log(User.getUser());
                                console.log('recv child_port =' + data.child_port);
                                User.setChildPort(data.child_port);
                            })
                            .error(function (data) {
                                window.alert('Error: ' + data);
                            });
                    }
                    else {
                        firsttime_skip = 1;
                    }
                }
                else {
                    console.log('you have to signin~');
                }
            });
    }
    else
    {
        $http.get('/child_port')
            .success(function (data) {
                console.log('recv child_port =' + data.child_port);
                return data;
            })
            .error(function (data) {
                window.alert('Error: ' + data);
            });
    }
});

bs.controller('homeCtrl', function ($q, $scope, $http, User) {
    console.log('Start homeCtrl');
});

bs.controller('blogCtrl', function ($scope, $http, User) {
    $scope.user = User.getUser();
    $scope.child_port = User.getChildPort();
    //set/get Child port is not working now.
    $scope.child_port = 20149;
    $scope.message = 'Your blog ctrl';
});

bs.controller('blogHistoryCtrl', function ($scope, $http, User) {
    $scope.user = User.getUser();
    $scope.child_port = User.getChildPort();
    //set/get Child port is not working now.
    $scope.child_port = 20149;
    $scope.title = "Blog Sync Histories";
    $scope.histories = [];

    var user = $scope.user;

    if (user.id == undefined) {
        console.log('you have to signin~');
    }

    var child_url = 'http://www.justwapps.com:'+ $scope.child_port +'/blog';
    var childio = io.connect(child_url);
    console.log('child_url='+child_url);

    childio.emit('blog', {"msg":'getHistories',"user":user});

    childio.on('histories', function(data){
        $scope.$apply(function () {
            $scope.histories = data.histories;
        });
    });
});


bs.controller('blogRegisterCtrl', function ($scope, $http, User) {
    $scope.user = User.getUser();
    $scope.message = 'Your blog groups';
    $scope.button = ['Delete', 'Create', 'Close'];
    $scope.groups = [];
    $scope.sites = [];
    $scope.selected = [];

    $scope.child_port = User.getChildPort();
    //set/get Child port is not working now.
    $scope.child_port = 20149;

    $scope.onClickButton = function(button) {
        if (button === 'Delete') {
            $scope.button[0] = 'Confirm';
        } else if (button === 'Confirm') {
            $scope.button[0] = 'Delete';
        } else if (button === 'Create') {
            disselectAllBlog();
            $scope.button[1] = 'Register';
        } else if (button === 'Close') {
            $scope.button[1] = 'Create';
        } else if (button === 'Register') {
            registerBlogGroup();
        }
    };

    $scope.onClickGroup = function(group_index, blog_index) {
        if ($scope.button[0] !== 'Confirm') {
            return;
        }
        var group = $scope.groups[group_index];
        group.splice(blog_index, 1);
        if (group.length === 0) {
            $scope.groups.splice(group_index, 1);
        }
    };

    $scope.onClickBlog = function(index) {
        if ($scope.selected[index] === 'normal') {
            $scope.selected[index] = 'selected';
        } else {
            $scope.selected[index] = 'normal';
        }
    };

    function disselectAllBlog() {
        for (var i = 0; i < $scope.sites.length; i += 1) {
            $scope.selected[i] = 'normal';
        }
    }

    function registerBlogGroup() {
        var group = [];
        for (var i = 0; i < $scope.sites.length; i += 1) {
            if ($scope.selected[i] === 'selected') {
                group.push($scope.sites[i]);
            }
        }
        if (group.length > 0) {
            $scope.groups.push(group);
        }
    }

    function init() {
    	var user = $scope.user;
        if (user.id == undefined) {
            console.log('you have to signin~');
            return;
        }

        var child_url = 'http://www.justwapps.com:'+ $scope.child_port +'/blog';
        var childio = io.connect(child_url);
        console.log('child_url='+child_url);

        childio.on('connect', function () {
            childio.emit('blog', {"msg":'getSites', "user":user});
            childio.emit('blog', {"msg":'getGroups', "user":user});
        });

        childio.on('sites', function(data){
            console.log(data);
            $scope.$apply(function () {
                $scope.sites = data;
            });
        });

        childio.on('groups', function(data){
            console.log(data);
            $scope.$apply(function () {
                $scope.groups = data.groups;
            });
        });

        disselectAllBlog();
    }

    init();
});

bs.controller('blogCollectFeedbackCtrl', function ($scope, $http, User) {
    $scope.user = User.getUser();
    $scope.message = 'Collect Feedback';

    $scope.child_port = User.getChildPort();
    //set/get Child port is not working now.
    $scope.child_port = 20149;
    $scope.posts = [];

    function init() {
    	var user = $scope.user;
        if (user.id == undefined) {
            console.log('you have to signin~');
            return;
        }

        var child_url = 'http://www.justwapps.com:'+ $scope.child_port +'/blog';
        var childio = io.connect(child_url);
        console.log('child_url='+child_url);

        childio.emit('blog', {"msg":'getPosts',"user":user});
        childio.on('connect', function(){
            childio.emit('blog', {"msg":'getPosts',"user":user});
        });

        childio.on('posts', function(data){
            var post_ids = [];
            for (var i=0; i<data.post_db.length; i++) {
                console.log('push post_id='+data.post_db[i].id);
                post_ids.push(data.post_db[i].id);
            }
            var messages = {"msg":'get_reply_count',"user":user,"post_ids":post_ids};
            console.log('send get_reply_count post_ids='+post_ids.length);
            childio.emit('blog', messages );

            $scope.$apply(function () {
                $scope.posts = data.post_db;
            });
        });

        childio.on('reply_count', function(data) {
            console.log('reply_count');
            console.log(data);
            for (var i = 0; i<$scope.posts.length; i++) {
                if ($scope.posts[i].id !== data.post_id) {
                    continue;
                }

                for (var j=0; j<$scope.posts[i].infos.length; j++) {
                    var info = $scope.posts[i].infos[j];

                    if (info.provider_name === data.provider_name && info.blog_id === data.blog_id) {
                        $scope.$apply(function () {
                            console.log('provider='+info.provider_name+' blog='+info.blog_id+
                                ' add comment_count, like_count');
                            $scope.posts[i].infos[j].replies = data.replies;
                        });
                        break;
                    }
                }
                break;
            }
        });

//        // About blogCollectFeedback
//        var postsID = 0;
//        childio.on('connect', function(data){
//            var messages = { "msg":'getComments', "user":user, "postID":postsID };
//            childio.emit('blog', messages );
//        });
//        childio.on('comments', function(data){
//            var comments = data.comments[0].content;
//            $scope.$apply(function() {
//                $scope.comments = comments;
//            });
//        });

    }

    init();
});

bs.controller('signinCtrl', function ($scope, $http, User) {
    $scope.user = User.getUser();
    $scope.providers = [ "Wordpress", "tistory", "google", "facebook", "tumblr", "twitter", "kakao"];

    if ($scope.user.id) {
        $scope.message = 'Your accounts';
    }
    else {
        $scope.message = 'Please sign in';
    }
});